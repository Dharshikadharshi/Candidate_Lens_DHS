import re
import requests
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

class GitHubVerificationError(Exception):
    pass

def normalize_github_url(url: str) -> Optional[str]:
    """Normalize GitHub URL and extract username."""
    if not url:
        return None
    # Prevent SSRF by only accepting github.com
    github_pattern = re.compile(r"^(?:https?://)?(?:www\.)?github\.com/([a-zA-Z0-9-]+)/?$", re.IGNORECASE)
    match = github_pattern.match(url)
    if not match:
        return None
    username = match.group(1)
    return f"https://github.com/{username}"

def get_github_username(url: str) -> Optional[str]:
    """Extract username from github URL."""
    if not url:
        return None
    github_pattern = re.compile(r"^(?:https?://)?(?:www\.)?github\.com/([a-zA-Z0-9-]+)/?$", re.IGNORECASE)
    match = github_pattern.match(url)
    if not match:
        return None
    return match.group(1)

def fetch_github_profile(username: str) -> dict:
    """Fetch profile info from GitHub API."""
    api_url = f"https://api.github.com/users/{username}"
    try:
        response = requests.get(api_url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return {
                "status": "verified",
                "username": username,
                "profile_url": data.get("html_url"),
                "public_repositories": data.get("public_repos", 0),
                "avatar_url": data.get("avatar_url")
            }
        elif response.status_code == 404:
            return {"status": "not_found", "message": "GitHub profile not found."}
        elif response.status_code in (403, 429):
            return {"status": "unavailable", "message": "GitHub API rate limit reached."}
        else:
            return {"status": "unavailable", "message": f"GitHub API error: {response.status_code}"}
    except requests.RequestException:
        return {"status": "unavailable", "message": "Could not connect to GitHub API."}

def fetch_public_repositories(username: str, limit: int = 30) -> List[dict]:
    """Fetch public repositories with pagination."""
    repos = []
    page = 1
    while len(repos) < limit:
        api_url = f"https://api.github.com/users/{username}/repos?sort=updated&per_page=30&page={page}"
        try:
            response = requests.get(api_url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if not data:
                    break
                for r in data:
                    repos.append({
                        "name": r.get("name"),
                        "full_name": r.get("full_name"),
                        "html_url": r.get("html_url"),
                        "description": r.get("description"),
                        "is_fork": r.get("fork", False),
                        "is_archived": r.get("archived", False),
                        "language": r.get("language"),
                        "topics": r.get("topics", []),
                        "pushed_at": r.get("pushed_at"),
                        "default_branch": r.get("default_branch")
                    })
                page += 1
            else:
                break
        except requests.RequestException:
            break
    return repos

def fetch_repository_file(full_name: str, file_path: str, default_branch: str = "main") -> Optional[str]:
    """Fetch raw file content from a repository safely."""
    url = f"https://raw.githubusercontent.com/{full_name}/refs/heads/{default_branch}/{file_path}"
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            return response.text[:10000] # Limit size to prevent memory issues and huge context
    except requests.RequestException:
        pass
    
    # Try master branch if main fails
    if default_branch == "main":
        url = f"https://raw.githubusercontent.com/{full_name}/refs/heads/master/{file_path}"
        try:
            response = requests.get(url, timeout=5)
            if response.status_code == 200:
                return response.text[:10000]
        except requests.RequestException:
            pass
            
    return None

def verify_github_projects(github_url: str, resume_projects: List[dict], ai_client, candidate_id: str) -> tuple[dict, List[dict]]:
    """Complete GitHub verification flow for profile and projects."""
    username = get_github_username(github_url)
    
    if not username:
        return {"status": "not_found", "message": "No valid GitHub URL detected in resume."}, []
        
    profile_data = fetch_github_profile(username)
    if profile_data["status"] != "verified":
        return profile_data, []
        
    repositories = fetch_public_repositories(username, limit=30)
    
    project_matches = []
    
    for project in resume_projects:
        # Phase 1: Simple heuristic matching to find top candidate repos
        best_repo = None
        best_score = 0
        p_name = str(project.get("project_name", "")).lower()
        p_techs = [t.lower() for t in project.get("technologies", [])]
        
        for repo in repositories:
            score = 0
            r_name = str(repo.get("name", "")).lower()
            r_desc = str(repo.get("description", "")).lower()
            
            if p_name and (p_name in r_name or r_name in p_name):
                score += 5
                
            if repo.get("language") and repo.get("language").lower() in p_techs:
                score += 2
                
            for t in p_techs:
                if t in r_name or t in r_desc or t in repo.get("topics", []):
                    score += 1
                    
            if score > best_score:
                best_score = score
                best_repo = repo
                
        if not best_repo or best_score < 1:
            project_matches.append({
                "resume_project": project.get("project_name", "Unknown Project"),
                "repository": None,
                "repository_url": None,
                "status": "NOT_FOUND",
                "confidence": 0.0,
                "technology_evidence": [],
                "missing_claims": project.get("technologies", []),
                "evidence": [{"source": "GitHub Search", "detail": "No matching public repository found."}]
            })
            continue
            
        # Fetch README for deeper inspection
        readme_content = fetch_repository_file(best_repo["full_name"], "README.md", best_repo.get("default_branch", "main"))
        req_content = fetch_repository_file(best_repo["full_name"], "requirements.txt", best_repo.get("default_branch", "main"))
        pkg_content = fetch_repository_file(best_repo["full_name"], "package.json", best_repo.get("default_branch", "main"))
        
        # Analyze technologies
        found_techs = []
        missing_techs = []
        evidence = []
        
        repo_text = f"{best_repo['name']} {best_repo['description']} {best_repo.get('language', '')} {' '.join(best_repo.get('topics', []))}"
        if readme_content:
            repo_text += f" {readme_content}"
        if req_content:
            repo_text += f" {req_content}"
        if pkg_content:
            repo_text += f" {pkg_content}"
            
        repo_text = repo_text.lower()
        
        for tech in project.get("technologies", []):
            if tech.lower() in repo_text:
                found_techs.append(tech)
            else:
                missing_techs.append(f"No evidence for {tech}")
                
        evidence.append({"source": "Repository Metadata", "detail": f"Matched repository '{best_repo['name']}' based on name and description."})
        
        if best_repo.get("is_fork"):
            evidence.append({"source": "GitHub Metadata", "detail": "Repository is a fork; independent authorship could not be fully established from public metadata."})
        if best_repo.get("is_archived"):
            evidence.append({"source": "GitHub Metadata", "detail": "Repository is archived."})
            
        if len(found_techs) > 0:
            evidence.append({"source": "Repository Content", "detail": f"Found evidence for: {', '.join(found_techs)}"})
            
        status = "WEAK_EVIDENCE"
        if len(found_techs) == len(project.get("technologies", [])) and len(found_techs) > 0:
            status = "VERIFIED"
        elif len(found_techs) > 0:
            status = "PARTIALLY_VERIFIED"
            
        project_matches.append({
            "resume_project": project.get("project_name", "Unknown Project"),
            "repository": best_repo["name"],
            "repository_url": best_repo["html_url"],
            "status": status,
            "confidence": min(1.0, len(found_techs) / max(1, len(project.get("technologies", []))) * 0.8 + 0.2),
            "technology_evidence": found_techs,
            "missing_claims": missing_techs,
            "evidence": evidence
        })
        
    return profile_data, project_matches
