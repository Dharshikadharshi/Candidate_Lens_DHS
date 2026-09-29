import re
import requests
import logging

logger = logging.getLogger(__name__)

def verify_github_profile(url: str) -> dict:
    if not url:
        return {"status": "not_provided", "message": "No GitHub URL provided"}
    
    # Check if URL is valid format
    github_pattern = re.compile(r"^(https?://)?(www\.)?github\.com/([a-zA-Z0-9-]+)/?$")
    match = github_pattern.match(url)
    if not match:
        return {"status": "invalid_url", "message": "Invalid GitHub URL format"}
        
    username = match.group(3)
    
    try:
        api_url = f"https://api.github.com/users/{username}"
        response = requests.get(api_url, timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            # Fetch repos (max 5 for quick check)
            repos_url = data.get("repos_url")
            repos_response = requests.get(f"{repos_url}?sort=updated&per_page=5", timeout=5)
            repos_data = []
            if repos_response.status_code == 200:
                repos = repos_response.json()
                for r in repos:
                    repos_data.append({
                        "name": r.get("name"),
                        "description": r.get("description"),
                        "language": r.get("language")
                    })
                    
            return {
                "status": "verified",
                "profile_reachable": True,
                "username": username,
                "public_repositories": data.get("public_repos", 0),
                "repositories_checked": len(repos_data),
                "repos_sample": repos_data,
                "warnings": []
            }
        elif response.status_code == 404:
            return {"status": "unavailable", "message": "GitHub profile not found or private"}
        else:
            return {"status": "unavailable", "message": f"GitHub API error: {response.status_code}"}
    except Exception as e:
        logger.warning(f"Failed to verify GitHub profile {username}: {str(e)}")
        return {"status": "unavailable", "message": "Could not connect to GitHub"}


def verify_linkedin_profile(url: str) -> dict:
    if not url:
        return {"status": "not_provided", "message": "No LinkedIn URL provided"}
        
    # Valid URL Check
    linkedin_pattern = re.compile(r"^(https?://)?(www\.)?linkedin\.com/in/.*$")
    if not linkedin_pattern.match(url):
        return {"status": "invalid_url", "message": "Invalid LinkedIn URL format"}
        
    # We do NOT try to scrape LinkedIn directly as it actively blocks bots and can lead to IP bans.
    # Therefore, we safely verify URL validity and mark as publicly restricted.
    return {
        "status": "restricted",
        "valid_url": True,
        "message": "Public profile verification unavailable (LinkedIn restricts automated access)."
    }
