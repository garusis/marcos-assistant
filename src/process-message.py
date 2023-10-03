from flask import Flask, request, jsonify
from google.cloud import datastore, tasks_v2
from google.protobuf import duration_pb2, timestamp_pb2
import os
import json

from environment import environment
from openai import get_audio_transcription
from whatsapp import mark_message_as_read, retrieve_media, send_whatsapp_message, notify_invalid_contact

app = Flask(__name__)
datastore_client = datastore.Client()
tasks_client = tasks_v2.CloudTasksClient()


def handle_authentication(req):
    if (
        req.args.get("hub.mode") != "subscribe"
        or req.args.get("hub.verify_token") != environment().get("WEBHOOK_VERIFY_TOKEN")
    ):
        return "", 400
    return jsonify(req.args.get("hub.challenge")), 200


async def define_contact_id(contact_id, contacts):
    contact_key = datastore_client.key("Contact", contact_id)
    existing_contact = datastore_client.get(contact_key)
    if existing_contact:
        return contact_key

    contact = next((contact for contact in contacts if contact["wa_id"] == contact_id), None)

    contact_name = contact["profile"]["name"] if contact else "Anonimo"
    contact_entity = datastore.Entity(key=contact_key)
    contact_entity.update({"name": contact_name})
    datastore_client.put(contact_entity)

    return contact_key


async def append_to_history_chat(message, message_text, contacts):
    contact_key = await define_contact_id(message["from"], contacts)

    message_key = datastore_client.key("Message", message["id"])
    message_entity = datastore.Entity(key=message_key)
    message_entity.update(
        {
            "messageId": message["id"],
            "from": contact_key,
            "text": message_text,
            "timestamp": datastore_client.transaction(),
            "actor": "user",
        }
    )
    datastore_client.put(message_entity)


async def send_to_queue(contact_id, message_id):
    queue_name = environment().get("GC_TASK_CHAT_QUEUE")
    location = environment().get("GC_TASK_LOCATION")
    project_id = os.getenv("PROJECT_ID", "GC_PROJECT_ID")
    queue_path = tasks_client.queue_path(project_id, location, queue_name)

    request_body = json.dumps({"contactId": contact_id, "messageId": message_id})
    task = {
        "http_request": {
            "http_method": "POST",
            "url": environment().get("WEBHOOK_QUEUE_PROCESSOR_URL"),
            "headers": {"Content-Type": "application/json"},
            "body": request_body.encode("utf-8").decode("latin-1"),
        },
        "schedule_time": (timestamp_pb2.Timestamp(seconds=int((time.time() + 10) * 1e9))),
        "oidc_token": {"service_account_email": environment().get("GC_SERVICE_ACCOUNT_EMAIL")},
    }
    tasks_client.create_task({"parent": queue_path, "task": task})


async def get_message_text(message):
    if message["type"] == "text":
        return message["text"]["body"]
    elif message["type"] == "audio":
        stream = await retrieve_media(message["audio"]["id"])
        response = await get_audio_transcription(stream)
        text = response["data"]["text"]
        await send_whatsapp_message(
            message["from"],
            f"Esto es lo que entendí en tu mensaje:\n*{text}*\nPor favor, dame un momento mientras reflexiono sobre la respuesta adecuada.",
        )
        return text
    else:
        return None


async def process_message(change):
    message = change["value"].get("messages", [])[0]
    contacts = change["value"].get("contacts", [])

    if not message:
        return

    if message["from"] not in environment().get("CONTACTS_WHITE_LIST", []):
        notify_invalid_contact(message["from"])
        return

    try:
        mark_message_as_read(message["id"])
        message_text = await get_message_text(message)

        if message_text is None:
            await send_whatsapp_message(message["from"], "Lo siento, no puedo entender este tipo de mensajes")
            return

        await append_to_history_chat(message, message_text, contacts)
        await send_to_queue(message["from"], message["id"])
    except Exception as e:
        print(e)
        await send_whatsapp_message(
            message["from"],
            "¡Ups! Algo no está bien 🤒. Por favor, contacta al soporte técnico para que puedan resolver la situación lo más pronto posible.",
        )


@app.route("/message", methods=["GET"])
def handle_get_request():
    return handle_authentication(request)


@app.route("/message", methods=["POST"])
async def handle_post_request():
    body = request.get_json(force=True)
    entry = body.get("entry", [{}])[0]

    if entry.get("id") != environment().get("WHATSAPP_ACCOUNT_ID"):
        return "", 200

    changes = entry.get("changes", [])
    changes_with_messages = [change for change in changes if "messages" in change.get("value", {})]

    if not changes_with_messages:
        return "", 200

    await process_message(changes_with_messages[0])

    return "", 200


if __name__ == "__main__":
    app.run()
