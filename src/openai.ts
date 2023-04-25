import axios from "axios";
import { Readable } from "stream";
import FormData from "form-data";
import { environment } from "./environment";

type OpenAICompletionsResponse = {
  choices: Array<{
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: "stop" | "length";
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};
function getCompletions(messages: Array<{ role: string; content: string }>) {
  return axios.post<OpenAICompletionsResponse>(
    `https://api.openai.com/v1/chat/completions`,
    {
      model: environment().OPENAI_CHAT_MODEL,
      max_tokens: environment().OPENAI_MAX_RESPONSE_TOKENS,
      temperature: 0.8,
      messages,
    },
    {
      headers: {
        Authorization: `Bearer ${environment().OPENAI_API_KEY}`,
      },
    }
  );
}

function getAudioTranscription(dataStream: Readable) {
  const data = new FormData();
  data.append("file", dataStream, {
    filename: "audio.mp3",
    contentType: "audio/mp3",
  });
  data.append("model", environment().OPENAI_TRANSCRIPTION_MODEL);
  return axios.post<{ text: string }>(
    "https://api.openai.com/v1/audio/transcriptions",
    data,
    {
      headers: {
        ...data.getHeaders(),
        Authorization: `Bearer ${environment().OPENAI_API_KEY}`,
      },
    }
  );
}

export { getCompletions, getAudioTranscription };
