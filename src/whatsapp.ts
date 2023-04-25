import axios from "axios";
import { Readable, PassThrough } from "stream";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { environment } from "./environment";

const GRAPH_API_URL = "https://graph.facebook.com/v16.0";

ffmpeg.setFfmpegPath(ffmpegStatic as string);

async function sendWhatsappMessage(contactId: string, text: string) {
  const response = await axios.post<{
    messages: [
      {
        id: string;
      }
    ];
  }>(
    `${GRAPH_API_URL}/${environment().WHATSAPP_PHONE_ID}/messages`,
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

async function getMediaMetadata(mediaId: string) {
  const response = await axios.get<{
    messaging_product: "whatsapp";
    url: string;
    mime_type: string;
    sha256: string;
    file_size: string;
    id: string;
  }>(`${GRAPH_API_URL}/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${environment().WHATSAPP_MESSAGING_TOKEN}`,
    },
  });
  return response.data;
}

async function retrieveMedia(mediaId: string) {
  const meta = await getMediaMetadata(mediaId);

  const passThroughStream = new PassThrough();

  const response = await axios.get<Readable>(meta.url, {
    headers: {
      Authorization: `Bearer ${environment().WHATSAPP_MESSAGING_TOKEN}`,
    },
    responseType: "stream",
  });

  ffmpeg(response.data)
    .outputFormat("mp3")
    .output(passThroughStream, { end: true })
    .run();

  return { stream: passThroughStream, meta };
}

export { sendWhatsappMessage, getMediaMetadata, retrieveMedia };
