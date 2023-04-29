import { sendWhatsappMessage } from "@whatsapp";
import * as console from "console";
import { environment } from "@environment";

const politePhrases = [
  "Acabo de recibir tu mensaje, dame un momentito para responderte.",
  "Estoy leyendo tu mensaje, enseguida te contesto.",
  "Dame un segundo, estoy un poco ocupada pero te responderé pronto.",
  "Gracias por tu mensaje, permíteme un instante para responderte.",
  "He leído tu mensaje, dame un minuto para escribirte.",
  "Estoy revisando tu mensaje, sólo un momentito y te contesto.",
  "Un poquito de tiempo, estoy ocupada pero te responderé en breve.",
  "Aprecio tu mensaje, dame un momento para escribirte.",
  "Estoy atenta a tu mensaje, sólo necesito un segundo para contestarte.",
  "Leí tu mensaje, aguárdame un instante y te responderé.",
  "Recibí tu mensaje, dame un ratito para escribirte.",
  "Estoy un poco ocupada, pero enseguida te contesto, gracias por esperar.",
  "Acabo de leer tu mensaje, dame un minuto y te responderé.",
  "Un momentito, estoy ocupada pero te escribiré en breve.",
  "Gracias por tu mensaje, enseguida te contesto.",
  "He visto tu mensaje, permíteme un segundo para responder.",
  "Estoy leyendo lo que me escribiste, aguárdame un momento.",
  "Necesito un instante, estoy un poco ocupada pero te contestaré en breve.",
  "Tu mensaje es importante para mí, dame un minuto para responderte.",
  "Estoy atenta a lo que me dices, sólo un momentito y te escribo.",
  "Leí tu mensaje, permíteme un segundo para contestarte.",
  "Estoy un poco ocupada, pero en breve te responderé, gracias por tu paciencia.",
  "Recibí tu mensaje, dame un momentito para contestarte.",
  "Un poquito de tiempo, estoy leyendo tu mensaje y te responderé enseguida.",
  "Gracias por escribirme, enseguida te contesto.",
  "He visto lo que me dices, sólo necesito un minuto para responderte.",
  "Estoy un poco ocupada, pero pronto te escribiré, gracias por esperar.",
  "Leí tu mensaje, aguárdame un instante para responderte.",
  "Estoy leyendo lo que me escribiste, dame un segundo.",
  "Recibí tu mensaje, gracias por tu paciencia, en breve te contesto.",
];

function getPolitePhrase() {
  const random = Math.floor(Math.random() * politePhrases.length);
  return politePhrases[random];
}

function sendPoliteMessage(contactId: string) {
  const message = getPolitePhrase();
  return setTimeout(
    () =>
      sendWhatsappMessage(contactId, message).catch((err) => {
        console.error("Error sending polite message", { contactId });
        console.error(err);
      }),
    3000
  );
}

function notifyInvalidContact(invalidContactNumer: string) {
  for (const owner of environment().MODERATOR_PHONE_LIST) {
    void sendWhatsappMessage(
      owner,
      `El número ${invalidContactNumer} ha intentado escribirme y no está en la lista de contactos válidos. Podrias revisar?`
    );
  }
}

export { sendPoliteMessage, notifyInvalidContact };
