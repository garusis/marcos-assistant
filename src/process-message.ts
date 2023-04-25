import { Request, Response } from "express";
import express from "express";
import bodyParser from "body-parser";
import { Datastore } from "@google-cloud/datastore";
import { CloudTasksClient } from "@google-cloud/tasks";
import { environment } from "./environment";
import { getAudioTranscription } from "./openai";
import {
  getMediaMetadata,
  retrieveMedia,
  sendWhatsappMessage,
} from "./whatsapp";
import { AxiosError } from "axios";
import { PassThrough } from "stream";

const tasksClient = new CloudTasksClient();

const datastore = new Datastore();

type WSBaseMessage = {
  from: string;
  id: string;
  timestamp: string;
};

type WSTextMessage = {
  text: {
    body: string;
  };
  type: "text";
} & WSBaseMessage;

type WSAudioMessage = {
  audio: {
    id: string;
    mime_type: string;
  };
  type: "audio";
} & WSBaseMessage;

type WSMessage = WSTextMessage | WSAudioMessage;

type WSContact = { profile: { name: string }; wa_id: string };

type WSChange = {
  value?: {
    metadata?: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: Array<WSContact>;
    messages?: Array<WSMessage>;
  };
  field: string;
};

type HookBody = {
  object?: string;
  entry?: Array<{
    id: string;
    changes?: Array<WSChange>;
  }>;
};

function handleAuthentication(req: Request, res: Response) {
  if (
    req.query["hub.mode"] !== "subscribe" ||
    req.query["hub.verify_token"] !== environment().WEBHOOK_VERIFY_TOKEN
  ) {
    res.sendStatus(400);
    return;
  }
  res.send(req.query["hub.challenge"]);
}

async function defineContactId(contactId: string, contacts: Array<WSContact>) {
  const contactKey = datastore.key(["Contact", contactId]);
  const [existingContact] = await datastore.get(contactKey);
  if (existingContact) return contactKey;

  const contact = contacts.find((contact) => contact.wa_id === contactId);

  const contactName = contact ? contact.profile.name : "Anonimo";
  const contactEntity = {
    key: contactKey,
    data: {
      name: contactName,
    },
  };
  await datastore.save(contactEntity);

  return contactKey;
}

async function appendToHistoryChat(
  message: WSBaseMessage,
  messageText: string,
  contacts: Array<WSContact>
) {
  const contactKey = await defineContactId(message.from, contacts);

  // Guarda el mensaje en Datastore
  const messageKey = datastore.key(["Message", message.id]);
  const messageEntity = {
    key: messageKey,
    data: [
      {
        name: "messageId",
        value: message.id,
      },
      {
        name: "from",
        value: contactKey,
      },
      {
        name: "text",
        value: messageText,
        excludeFromIndexes: true,
      },
      {
        name: "timestamp",
        value: Date.now(),
      },
      {
        name: "actor",
        value: "user",
      },
    ],
  };
  await datastore.save(messageEntity);
}

async function sendToQueue(contactId: string, messageId: string) {
  const queueName = environment().GC_TASK_CHAT_QUEUE;
  const location = environment().GC_TASK_LOCATION;
  const projectId = environment().GC_PROJECT_ID;
  const queuePath = tasksClient.queuePath(projectId, location, queueName);

  const task = {
    httpRequest: {
      httpMethod: "POST" as const,
      url: environment().WEBHOOK_QUEUE_PROCESSOR_URL,
      headers: {
        "Content-Type": "application/json",
      },
      body: Buffer.from(JSON.stringify({ contactId, messageId })).toString(
        "base64"
      ),
      scheduleTime: {
        seconds: Date.now() / 1000 + 60,
      },
      oidcToken: {
        serviceAccountEmail: environment().GC_SERVICE_ACCOUNT_EMAIL,
      },
    },
  };
  await tasksClient.createTask({ parent: queuePath, task });
}

async function getMessageText(message: WSMessage) {
  if (message.type === "text") return message.text.body;
  if (message.type === "audio") {
    const { stream } = await retrieveMedia(message.audio.id);
    const response = await getAudioTranscription(stream);
    const text = response.data.text;
    await sendWhatsappMessage(
      message.from,
      `Esto es lo que entendí en tu mensaje:\n\n*${text}*\n\nPor favor, dame un momento mientras reflexiono sobre la respuesta adecuada.`
    );
    return text;
  }
  return null;
}

async function processMessage(change: WSChange) {
  const message = change.value?.messages?.[0];
  const contacts = change.value?.contacts || [];
  if (!message) return;

  try {
    const messageText = await getMessageText(message);

    if (!messageText) {
      await sendWhatsappMessage(
        message.from,
        "Lo siento, no puedo entender este tipo de mensajes"
      );
      return;
    }

    await appendToHistoryChat(message, messageText, contacts);
    await sendToQueue(message.from, message.id);
  } catch (e) {
    if (e instanceof AxiosError) {
      console.error(e.response?.status);
      console.error(e.response?.statusText);
      console.error(JSON.stringify(e.response?.data));
    } else {
      console.error(e);
    }
    await sendWhatsappMessage(
      message.from,
      "¡Ups! Algo no está bien 🤒. Por favor, contacta al soporte técnico para que puedan resolver la situación lo más pronto posible."
    );
  }
}

async function handlePostRequest(req: Request, res: Response) {
  const body = req.body as HookBody;
  const changes = body.entry?.[0].changes || [];
  const changesWithMessages = changes.filter(
    (change) => !!change.value?.messages
  );

  if (changesWithMessages.length === 0) return res.sendStatus(200);

  await processMessage(changesWithMessages[0]);

  res.sendStatus(200);
}
const app = express();
app.use(bodyParser.json());

app.get("/message", handleAuthentication);
app.post("/message", handlePostRequest);
export default app;
