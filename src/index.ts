import { Request, Response } from "express";
import { HttpFunction } from "@google-cloud/functions-framework";
import express from "express";
import bodyParser from "body-parser";
import axios, { AxiosError } from "axios";
import * as process from "process";

type HookBody = {
  object?: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      value?: {
        metadata?: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          text: {
            body: string;
          };
          type: string;
        }>;
      };
      field: string;
    }>;
  }>;
};

function handleAuthentication(req: Request, res: Response) {
  if (
    req.query["hub.mode"] !== "subscribe" ||
    req.query["hub.verify_token"] !== process.env.WEBHOOK_VERIFY_TOKEN
  ) {
    res.sendStatus(400);
    return;
  }
  res.send(req.query["hub.challenge"]);
}

async function handlePostRequest(req: Request, res: Response) {
  try {
    const body = req.body as HookBody;
    const changes = body.entry?.[0].changes || [];
    const messages = changes.filter((change) => !!change.value?.messages);

    if (messages.length === 0) return res.sendStatus(200);

    const response = await axios.post(
      `https://graph.facebook.com/v16.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: "573144490360",
        type: "text",
        text: {
          preview_url: true,
          body: JSON.stringify(messages, null, 2),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_MESSAGING_TOKEN}`,
        },
      }
    );
    console.log(JSON.stringify(response.data, null, 2));
  } catch (e) {
    if (e instanceof AxiosError) {
      console.error(JSON.stringify(e.response?.data, null, 2));
    }
  }
  res.sendStatus(200);
}

const app = express();
app.use(bodyParser.json());

app.get("/message", handleAuthentication);
app.post("/message", handlePostRequest);

export const message: HttpFunction = app;
