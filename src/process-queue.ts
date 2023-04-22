import express, { Request, Response } from "express";
import { Datastore } from "@google-cloud/datastore";
import axios, { AxiosError } from "axios";
import bodyParser from "body-parser";
import * as console from "console";
import { entity } from "@google-cloud/datastore/build/src/entity";
import { encoding_for_model } from "@dqbd/tiktoken";
import { Configuration, OpenAIApi } from "openai";
import { environment } from "./environment";

type StoredMessage = {
  messageId: string;
  from: entity.Key;
  text: string;
  timestamp: number;
  actor: "user" | "assistant";
};

const datastore = new Datastore();

const configuration = new Configuration({
  apiKey: environment().OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

async function isFirstMessage(contactKey: entity.Key) {
  const [results] = await datastore.runQuery(
    datastore
      .createQuery("Message")
      .filter("from", "=", contactKey)
      .filter("actor", "=", "ai")
      .order("timestamp", { descending: true })
      .limit(1)
  );

  return !results[0];
}

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

function truncateText(text: string) {
  const encoding = encoding_for_model(environment().OPENAI_MODEL);
  const tokens = encoding.encode(text);
  const maxPromptTokens =
    environment().OPENAI_MAX_TOKENS - environment().OPENAI_MAX_RESPONSE_TOKENS;

  if (tokens.length > maxPromptTokens) {
    let currentTokens = tokens.slice(tokens.length - maxPromptTokens);
    let currentText = encoding.decode(currentTokens);
    encoding.free();
    return new TextDecoder().decode(currentText);
  }

  return text;
}

function filterMessages(messages: Array<StoredMessage>) {
  let remainingTokens =
    environment().OPENAI_MAX_TOKENS - environment().OPENAI_MAX_RESPONSE_TOKENS;
  const indexOutOfBound = messages.findIndex((message) => {
    const encoding = encoding_for_model(environment().OPENAI_MODEL);
    const tokens = encoding.encode(message.text);
    remainingTokens -= tokens.length;
    encoding.free();
    return remainingTokens < 0;
  });
  return messages.slice(0, indexOutOfBound - 1);
}

async function getMessagesHistory(contactKey: entity.Key) {
  const messagesQueryResult = await datastore.runQuery(
    datastore
      .createQuery("Message")
      .filter("from", "=", contactKey)
      .order("timestamp", { descending: true })
      .limit(1000)
  );
  const messages = messagesQueryResult[0] as Array<StoredMessage>;

  const isFirst = await isFirstMessage(contactKey);

  const chatHistory = filterMessages(messages)
    .reverse()
    .map((message) => ({ role: message.actor, content: message.text }));

  return isFirst
    ? [
        {
          role: "system" as const,
          content: environment().OPENAI_INITIAL_PROMPT,
        },
        ...chatHistory,
      ]
    : [
        {
          role: "system" as const,
          content: environment().OPENAI_DEFAULT_PROMPT,
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

async function sendWhatsappMessage(contactId: string, text: string) {
  const response = await axios.post<{
    messages: [
      {
        id: string;
      }
    ];
  }>(
    `https://graph.facebook.com/v16.0/${
      environment().WHATSAPP_PHONE_ID
    }/messages`,
    {
      messaging_product: "whatsapp",
      to: contactId,
      type: "text",
      text: {
        preview_url: true,
        body: text,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${environment().WHATSAPP_MESSAGING_TOKEN}`,
      },
    }
  );
  return response.data.messages[0].id;
}

async function handlePostRequest(req: Request, res: Response) {
  const { contactId, messageId } = req.body as {
    contactId: string;
    messageId: string;
  };

  const contactKey = datastore.key(["Contact", contactId]);
  try {
    const latestMessage = await retrieveLatestMessage(contactKey);
    if (latestMessage.messageId !== messageId) return;

    const messages = await getMessagesHistory(contactKey);

    const completion = await openai.createChatCompletion({
      model: environment().OPENAI_MODEL,
      messages,
      max_tokens: environment().OPENAI_MAX_RESPONSE_TOKENS,
      temperature: 0.8,
    });

    const chunks = splitStringIntoChunks(
      completion.data.choices?.[0]?.message?.content as string
    );
    for await (const chunk of chunks) {
      const messageId = await sendWhatsappMessage(contactId, chunk);
      await appendToHistoryChat(chunk, messageId, contactKey);
    }
  } catch (e) {
    if (e instanceof AxiosError) {
      console.error(e.response?.status);
      console.error(e.response?.statusText);
      console.error(JSON.stringify(e.response?.data));
    }
    console.error(e);
  }
  res.sendStatus(204);
}

const app = express();
app.use(bodyParser.json());

app.post("/", handlePostRequest);
export default app;
