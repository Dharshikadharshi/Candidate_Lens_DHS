# CandidateLens

CandidateLens is an HR-facing pre-round readiness platform.

## Setup Instructions

1. Clone the repository.
   ```bash
   git clone <repository-url>
   cd candidatelens
   ```

2. Create the virtual environment.
   ```bash
   cd backend
   python -m venv venv
   ```

3. Install dependencies.
   ```bash
   # Windows
   .\venv\Scripts\activate
   # Linux/Mac
   source venv/bin/activate
   
   pip install fastapi uvicorn sqlalchemy alembic psycopg2-binary pydantic pydantic-settings "python-jose[cryptography]" "passlib[bcrypt]" python-multipart
   
   # Frontend
   cd ../frontend
   npm install
   ```

4. Copy `.env.example` to `.env` in both `backend` and `frontend` directories.
   ```bash
   # Backend
   cd backend
   cp .env.example .env
   
   # Frontend
   cd frontend
   cp .env.example .env
   ```

5. Fill in the required local values in the `.env` files.
   - For backend, provide `DATABASE_URL` and `SECRET_KEY`.
   - For frontend, provide `VITE_API_BASE_URL`.

6. Run database migrations (or seed script).
   ```bash
   cd backend
   python seed.py
   ```

7. Start the backend.
   ```bash
   cd backend
   uvicorn app.main:app --reload --port 8000
   ```

8. Start the frontend.
   ```bash
   cd frontend
   npm run dev
   ```
