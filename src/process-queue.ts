import express, { Request, Response } from "express";
import { Datastore } from "@google-cloud/datastore";
import axios, { AxiosError } from "axios";
import bodyParser from "body-parser";
import * as console from "console";
import { entity } from "@google-cloud/datastore/build/src/entity";
import { encoding_for_model } from "@dqbd/tiktoken";
import { sendWhatsappMessage } from "@whatsapp";
import { environment } from "@environment";
import { getCompletions } from "@openai";
import { sendPoliteMessage } from "@conversation";

type Contact = {
  name: string;
};

type StoredMessage = {
  messageId: string;
  from: entity.Key;
  text: string;
  timestamp: number;
  actor: "user" | "assistant";
};

const datastore = new Datastore();

async function retrieveLatestMessage(contactKey: entity.Key) {
  const queryResponse = await datastore.runQuery(
    datastore
      .createQuery("Message")
      .filter("from", "=", contactKey)
      .filter("actor", "=", "user")
      .order("timestamp", { descending: true })
      .limit(1)
  );
  const results = queryResponse[0] as Array<StoredMessage>;

  return results[0];
}

function getTokensCount(message: string) {
  const encoding = encoding_for_model(environment().OPENAI_CHAT_MODEL);
  const count = encoding.encode(message).length;
  encoding.free();
  return count + environment().OPENAI_MESSAGE_TOKENS_PADDING;
}

function truncateText(text: string, maxTokens: number) {
  const encoding = encoding_for_model(environment().OPENAI_CHAT_MODEL);
  const tokens = encoding.encode(text);

  const tokensCount =
    tokens.length + environment().OPENAI_MESSAGE_TOKENS_PADDING;

  let currentTokens = tokens.slice(maxTokens - tokensCount);
  let currentText = encoding.decode(currentTokens);
  encoding.free();
  return new TextDecoder().decode(currentText);
}

function filterMessages(messages: Array<StoredMessage>) {
  console.log(JSON.stringify(messages));
  const limitTokens =
    environment().OPENAI_MAX_TOKENS -
    environment().OPENAI_MAX_RESPONSE_TOKENS -
    10; // Add some padding to avoid out of bound errors

  let consumedTokens = getTokensCount(environment().OPENAI_INITIAL_PROMPT);

  const indexOutOfBound = messages.findIndex((message) => {
    const messageTokens = getTokensCount(message.text);

    if (consumedTokens + messageTokens > limitTokens) {
      return true;
    }

    consumedTokens += messageTokens;
    return false;
  });

  if (indexOutOfBound === -1) return messages;

  const lastMessage = messages[indexOutOfBound];
  lastMessage.text = truncateText(
    lastMessage.text,
    limitTokens - consumedTokens
  );
  return [...messages.slice(0, indexOutOfBound), lastMessage];
}

function groupMessages(
  messages: Array<StoredMessage>,
  contact: Contact
): Array<StoredMessage> {
  if (messages.length < 2) return messages; // No need to group

  const firstMessage = messages.shift() as StoredMessage; // We already know that the array is not empty

  return messages.reduce(
    (groupedMessages, message) => {
      const lastGroupedMessage = groupedMessages[groupedMessages.length - 1];

      // If the last message was sent by the same actor, group them
      if (lastGroupedMessage.actor === message.actor) {
        lastGroupedMessage.text = message.text + " " + lastGroupedMessage.text;
        return groupedMessages;
      }

      lastGroupedMessage.text =
        lastGroupedMessage.actor === "user"
          ? `${contact.name}: ${lastGroupedMessage.text}`
          : lastGroupedMessage.text;

      // Otherwise, add a new non-grouped message to the array
      groupedMessages.push(message);
      return groupedMessages;
    },
    [firstMessage] as [StoredMessage] & Array<StoredMessage>
  );
}

async function getMessagesHistory(contactKey: entity.Key, contact: Contact) {
  const messagesQueryResult = await datastore.runQuery(
    datastore
      .createQuery("Message")
      .filter("from", "=", contactKey)
      .order("timestamp", { descending: true })
      .limit(1000)
  );
  const messages = messagesQueryResult[0] as Array<StoredMessage>;

  const chatHistory = filterMessages(groupMessages(messages, contact))
    .reverse()
    .map((message) => ({ role: message.actor, content: message.text }));

  return [
    {
      role: "system" as const,
      content: environment().OPENAI_INITIAL_PROMPT,
    },
    ...chatHistory,
  ];
}

function splitStringIntoChunks(text: string) {
  const chunkSize = environment().WHATSAPP_MESSAGE_LIMIT;
  const numberOfChunks = Math.ceil(text.length / chunkSize);
  const chunks = [];

  for (let i = 0; i < numberOfChunks; i++) {
    const startIndex = i * chunkSize;
    const endIndex = startIndex + chunkSize;
    chunks.push(text.slice(startIndex, endIndex));
  }

  return chunks;
}

async function appendToHistoryChat(
  message: string,
  messageId: string,
  contactKey: entity.Key
) {
  // Guarda el mensaje en Datastore
  const messageKey = datastore.key(["Message", messageId]);
  const messageEntity = {
    key: messageKey,
    data: [
      {
        name: "messageId",
        value: messageId,
      },
      {
        name: "from",
        value: contactKey,
      },
      {
        name: "text",
        value: message,
        excludeFromIndexes: true,
      },
      {
        name: "timestamp",
        value: Date.now(),
      },
      {
        name: "actor",
        value: "assistant",
      },
    ],
  };
  await datastore.save(messageEntity);
}

async function handlePostRequest(req: Request, res: Response) {
  const { contactId, messageId } = req.body as {
    contactId: string;
    messageId: string;
  };

  const contactKey = datastore.key(["Contact", contactId]);
  try {
    const [existingContact] = (await datastore.get(contactKey)) as [Contact];

    const latestMessage = await retrieveLatestMessage(contactKey);
    if (latestMessage.messageId !== messageId) return;

    const politeMessageId = sendPoliteMessage(contactId);

    const messages = await getMessagesHistory(contactKey, existingContact);
    const response = await getCompletions(messages);

    console.log(response.data.usage);

    const chunks = splitStringIntoChunks(
      response.data.choices?.[0]?.message?.content as string
    );

    clearTimeout(politeMessageId);
    for await (const chunk of chunks) {
      const messageId = await sendWhatsappMessage(contactId, chunk);
      await appendToHistoryChat(chunk, messageId, contactKey);
    }
  } catch (e) {
    if (e instanceof AxiosError) {
      console.error(e.response?.status);
      console.error(e.response?.statusText);
      console.error(JSON.stringify(e.response?.data));
    } else {
      console.error(e);
    }
    await sendWhatsappMessage(
      contactId,
      "¡Ups! Algo no está bien 🤒. Por favor, contacta al soporte técnico para que puedan resolver la situación lo más pronto posible."
    );
  }
  res.sendStatus(204);
}

const app = express();
app.use(bodyParser.json());

app.post("/", handlePostRequest);
export default app;
