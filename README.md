# CandidateLens

CandidateLens is an HR-facing pre-round readiness platform.

## Overall Flow of the CandidateLens Project

The diagram below shows how CandidateLens works end to end, from HR login to the final assessment report.

![CandidateLens architecture and overall flow](CandidateLens%20Architecture%20Flow%20Diagram.png)

**How to read it**

1. **HR journey (top row):** HR logs in, opens the dashboard, manages candidates and opens a candidate profile. From there HR runs the resume actions, schedules an interview, conducts the live interview and reviews the final score analysis and report before making their own decision.
2. **Resume analysis / validation flow:** the uploaded resume is fetched from secure storage, its text and sections are extracted, processed with OpenAI, and the resulting report is stored in the database.
3. **Live interview flow:** HR starts the interview in the built-in LiveKit video room and the candidate joins. Questions are asked one at a time; spoken answers are converted to text, each answer is evaluated (with a follow-up when needed), questions, answers and scores are saved, and the final report is generated. HR sees scores update during the interview.
4. **AI services (OpenAI):** resume analysis, question generation, answer evaluation, follow-up generation, report generation and speech-to-text, all called from the backend with structured, validated outputs.
5. **Database (PostgreSQL):** the existing users, candidates, resumes and interviews tables, plus the assessment tables for analyses, question plans, questions, answers, evaluations and reports.

HR makes every hiring decision; the reports are evidence to support it and can be downloaded as PDF.

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
   
   pip install fastapi uvicorn sqlalchemy alembic psycopg2-binary pydantic pydantic-settings "python-jose[cryptography]" "passlib[bcrypt]" python-multipart openai pypdf python-docx reportlab
   pip install pytest httpx  # tests
   
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


## Resume Upload Feature
- Resumes are uploaded to ackend/uploads/resumes/ locally.
- Supported formats: PDF, DOC, DOCX.
- Maximum file size: 10MB.
