import { Request, Response } from "express";
import express from "express";
import bodyParser from "body-parser";
import { Datastore } from "@google-cloud/datastore";
import { CloudTasksClient } from "@google-cloud/tasks";
import { environment } from "./environment";

const tasksClient = new CloudTasksClient();

const datastore = new Datastore();

type Message = {
  from: string;
  id: string;
  timestamp: string;
  text: {
    body: string;
  };
  type: string;
};

type Contact = { profile: { name: string }; wa_id: string };

type Change = {
  value?: {
    metadata?: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: Array<Contact>;
    messages?: Array<Message>;
  };
  field: string;
};

type HookBody = {
  object?: string;
  entry?: Array<{
    id: string;
    changes?: Array<Change>;
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

async function defineContactId(contactId: string, contacts: Array<Contact>) {
  const contactKey = datastore.key(["Contact", contactId]);
  const [existingContact] = await datastore.get(contactKey);
  if (existingContact) return contactKey;

  const contact = contacts.find((contact) => contact.wa_id === contactId);

  const contactName = contact ? contact.profile.name : "Contacto Anonimo";
  const contactEntity = {
    key: contactKey,
    data: {
      name: contactName,
    },
  };
  await datastore.save(contactEntity);

  return contactKey;
}

async function appendToHistoryChat(message: Message, contacts: Array<Contact>) {
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
        value: message.text.body,
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

async function processMessage(change: Change) {
  const message = change.value?.messages?.[0];
  const contacts = change.value?.contacts || [];
  if (!message) return;

  await appendToHistoryChat(message, contacts);
  await sendToQueue(message.from, message.id);
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
