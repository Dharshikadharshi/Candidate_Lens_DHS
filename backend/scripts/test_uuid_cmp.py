import uuid
from uuid import UUID

current_user_id = UUID('0f9cf744-2e8e-452e-bd11-eddfa510efe1')
candidate_created_by = UUID('0f9cf744-2e8e-452e-bd11-eddfa510efe1')

print(f"current_user.id: {current_user_id} ({type(current_user_id)})")
print(f"candidate.created_by: {candidate_created_by} ({type(candidate_created_by)})")
print(f"Equal? {current_user_id == candidate_created_by}")
print(f"Not equal? {current_user_id != candidate_created_by}")
