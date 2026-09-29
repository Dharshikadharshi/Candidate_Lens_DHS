from app.core.security import verify_password, get_password_hash

plain = "my_secret_password"
hashed = get_password_hash(plain)
print("Hashed successfully")

assert verify_password(plain, hashed) == True
print("Verification with correct password passed")

assert verify_password("wrong", hashed) == False
print("Verification with wrong password passed")
