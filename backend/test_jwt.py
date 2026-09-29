import json
from jose import jwt
import time

API_KEY = "devkey"
API_SECRET = "secret"
room_name = "my-room"
identity = "user1"
display_name = "User One"
metadata = {"role": "hr"}

ttl_seconds = 600
now = int(time.time())

payload = {
    "iss": API_KEY,
    "nbf": now,
    "exp": now + ttl_seconds,
    "sub": identity,
    "jti": identity,
    "name": display_name,
    "metadata": json.dumps(metadata),
    "video": {
        "room": room_name,
        "roomJoin": True,
        "canPublish": True,
        "canSubscribe": True,
        "canPublishData": True,
    },
}

token = jwt.encode(payload, API_SECRET, algorithm="HS256")
print("Manual token payload:", jwt.decode(token, API_SECRET, algorithms=["HS256"]))
print("Token:", token)
