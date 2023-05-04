import * as z from "zod";

const stringBooleanSchema = z.preprocess(
  (v) => /true/i.test(String(v).trim()),
  z.boolean()
);

const stringNumberSchema = z.preprocess((v) => Number(v), z.number());

const trimmedStringSchema = z
  .string()
  .min(1)
  .transform((v) => v.trim());

const stringArraySchema = z.preprocess(
  (val) => String(val).split(","),
  z.array(trimmedStringSchema)
);

const envSchema = z.object({
  WEBHOOK_VERIFY_TOKEN: trimmedStringSchema,
  WEBHOOK_QUEUE_PROCESSOR_URL: trimmedStringSchema,
  WHATSAPP_MESSAGING_TOKEN: trimmedStringSchema,
  WHATSAPP_PHONE_ID: trimmedStringSchema,
  WHATSAPP_MESSAGE_LIMIT: stringNumberSchema,
  WHATSAPP_ACCOUNT_ID: trimmedStringSchema,
  GC_PROJECT_ID: trimmedStringSchema,
  GC_TASK_LOCATION: trimmedStringSchema,
  GC_TASK_CHAT_QUEUE: trimmedStringSchema,
  GC_SERVICE_ACCOUNT_EMAIL: trimmedStringSchema,
  OPENAI_CHAT_MODEL: z.enum(["gpt-3.5-turbo", "gpt-4"]),
  OPENAI_TRANSCRIPTION_MODEL: z.literal("whisper-1"),
  OPENAI_MAX_TOKENS: stringNumberSchema,
  OPENAI_MAX_RESPONSE_TOKENS: stringNumberSchema,
  OPENAI_MESSAGE_TOKENS_PADDING: stringNumberSchema,
  OPENAI_INITIAL_PROMPT: trimmedStringSchema,
  OPENAI_API_KEY: trimmedStringSchema,
  CONTACTS_WHITE_LIST: stringArraySchema,
  MODERATOR_PHONE_LIST: stringArraySchema,
});

/**
 * This function gets no arguments and returns all environment variables properly coerced and type checked.
 * @returns the environment variables parsed by the envSchema
 */
function environment() {
  return envSchema.parse(process.env);
}

export { environment };
