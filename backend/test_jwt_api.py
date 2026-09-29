import json
from jose import jwt
from livekit import api

token_builder = api.AccessToken("devkey", "secret").with_identity("user1").with_name("User One").with_metadata(json.dumps({"role": "hr"})).with_grants(api.VideoGrants(room_join=True, room="my-room", can_publish=True, can_subscribe=True, can_publish_data=True))
print("SDK generated token claims:", jwt.decode(token_builder.to_jwt(), "secret", algorithms=["HS256"]))
