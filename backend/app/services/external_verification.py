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

def verify_leetcode_profile(url: str, claims: list = None) -> dict:
    if not url or not isinstance(url, str):
        return {"status": "not_provided", "message": "No LeetCode URL provided"}
        
    leetcode_pattern = re.compile(r"^(https?://)?(www\.)?leetcode\.com/(?:u/)?([a-zA-Z0-9_-]+)/?$")
    match = leetcode_pattern.match(url)
    if not match:
        return {"status": "invalid_url", "message": "Invalid LeetCode URL format"}
        
    username = match.group(3)
    
    try:
        api_url = "https://leetcode.com/graphql"
        payload = {
            "query": "\n    query getUserProfile($username: String!) {\n  matchedUser(username: $username) {\n    username\n    profile {\n      ranking\n      reputation\n      starRating\n    }\n    submitStats {\n      acSubmissionNum {\n        difficulty\n        count\n        submissions\n      }\n    }\n  }\n}\n    ",
            "variables": {"username": username}
        }
        response = requests.post(api_url, json=payload, timeout=5, headers={"User-Agent": "Mozilla/5.0"})
        if response.status_code == 200:
            data = response.json()
            user_data = data.get("data", {}).get("matchedUser")
            if not user_data:
                return {"status": "not_found", "message": "LeetCode profile not found"}
                
            stats = user_data.get("submitStats", {}).get("acSubmissionNum", [])
            total_solved = 0
            for stat in stats:
                if stat.get("difficulty") == "All":
                    total_solved = stat.get("count", 0)
                    
            profile = user_data.get("profile", {})
            rating = profile.get("ranking", 0)
            
            result = {
                "status": "verified",
                "profile_url": f"https://leetcode.com/{username}/",
                "username": username,
                "solved": total_solved,
                "rating": rating,
                "message": "Public profile verified",
                "claims_verification": []
            }
            
            if claims:
                for claim in claims:
                    # Simple heuristic for common claims
                    claim_lower = claim.lower()
                    if "solved" in claim_lower or "problem" in claim_lower:
                        # Extract number
                        nums = [int(s) for s in re.findall(r'\d+', claim)]
                        if nums:
                            if total_solved >= nums[0]:
                                result["claims_verification"].append({
                                    "claim": claim,
                                    "status": "VERIFIED",
                                    "evidence": f"Public LeetCode profile reports {total_solved} solved problems."
                                })
                            else:
                                result["claims_verification"].append({
                                    "claim": claim,
                                    "status": "INCONSISTENCY",
                                    "evidence": f"Resume claims {claim}, but public profile shows {total_solved} solved problems."
                                })
                    elif "rating" in claim_lower:
                        nums = [int(s) for s in re.findall(r'\d+', claim)]
                        if nums:
                            if rating > 0:
                                diff = abs(rating - nums[0])
                                if diff < 200:
                                    result["claims_verification"].append({
                                        "claim": claim,
                                        "status": "VERIFIED",
                                        "evidence": f"Public LeetCode rating is approximately {rating}."
                                    })
                                else:
                                    result["claims_verification"].append({
                                        "claim": claim,
                                        "status": "INCONSISTENCY",
                                        "evidence": f"Resume states a LeetCode rating of approximately {nums[0]}, while the publicly accessible profile shows {rating}."
                                    })
                            else:
                                result["claims_verification"].append({
                                    "claim": claim,
                                    "status": "UNABLE_TO_VERIFY",
                                    "evidence": "Rating information not publicly accessible."
                                })
                                
            return result
        elif response.status_code == 404:
            return {"status": "not_found", "message": "LeetCode profile not found"}
        else:
            return {"status": "restricted", "message": "LeetCode profile access restricted"}
    except Exception as e:
        logger.warning(f"Failed to verify LeetCode profile {username}: {str(e)}")
        return {"status": "unavailable", "message": "Could not connect to LeetCode"}

def verify_hackerrank_profile(url: str, claims: list = None) -> dict:
    if not url or not isinstance(url, str):
        return {"status": "not_provided", "message": "No HackerRank URL provided"}
        
    hackerrank_pattern = re.compile(r"^(https?://)?(www\.)?hackerrank\.com/([a-zA-Z0-9_-]+)/?$")
    match = hackerrank_pattern.match(url)
    if not match:
        return {"status": "invalid_url", "message": "Invalid HackerRank URL format"}
        
    username = match.group(3)
    
    try:
        api_url = f"https://www.hackerrank.com/rest/hackers/{username}/badges"
        response = requests.get(api_url, timeout=5, headers={"User-Agent": "Mozilla/5.0"})
        if response.status_code == 200:
            data = response.json()
            badges = data.get("models", [])
            
            python_stars = 0
            for badge in badges:
                if badge.get("badge_name", "").lower() == "python":
                    python_stars = badge.get("stars", 0)
            
            result = {
                "status": "verified",
                "profile_url": f"https://www.hackerrank.com/{username}",
                "username": username,
                "badges": len(badges),
                "python_stars": python_stars,
                "message": "Public profile verified",
                "claims_verification": []
            }
            
            if claims:
                for claim in claims:
                    claim_lower = claim.lower()
                    if "python" in claim_lower and "star" in claim_lower:
                        nums = [int(s) for s in re.findall(r'\d+', claim)]
                        if nums:
                            if python_stars >= nums[0]:
                                result["claims_verification"].append({
                                    "claim": claim,
                                    "status": "VERIFIED",
                                    "evidence": f"Public HackerRank shows {python_stars}-star Python status."
                                })
                            else:
                                result["claims_verification"].append({
                                    "claim": claim,
                                    "status": "INCONSISTENCY",
                                    "evidence": f"Resume claim indicates {nums[0]}-star Python status; publicly accessible profile evidence shows {python_stars}-star status."
                                })
                                
            return result
        elif response.status_code == 404:
            return {"status": "not_found", "message": "HackerRank profile not found"}
        else:
            return {"status": "restricted", "message": "HackerRank profile access restricted"}
    except Exception as e:
        logger.warning(f"Failed to verify HackerRank profile {username}: {str(e)}")
        return {"status": "unavailable", "message": "Could not connect to HackerRank"}

