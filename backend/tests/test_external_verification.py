import pytest
from app.services.external_verification import (
    verify_linkedin_profile,
    verify_leetcode_profile,
    verify_hackerrank_profile
)
from app.ai.text import (
    extract_linkedin_url,
    extract_leetcode_url,
    extract_hackerrank_url
)
from unittest.mock import patch, MagicMock

def test_extract_linkedin_url():
    assert extract_linkedin_url("My profile is https://www.linkedin.com/in/haresh") == "https://www.linkedin.com/in/haresh"
    assert extract_linkedin_url("My profile is linkedin.com/in/haresh") == "https://www.linkedin.com/in/haresh"
    assert extract_linkedin_url("My profile is https://linkedin.com/in/haresh/") == "https://www.linkedin.com/in/haresh"

def test_extract_leetcode_url():
    assert extract_leetcode_url("My leetcode is https://leetcode.com/haresh/") == "https://leetcode.com/haresh/"
    assert extract_leetcode_url("My leetcode is https://www.leetcode.com/u/haresh/") == "https://leetcode.com/haresh/"
    assert extract_leetcode_url("My leetcode is leetcode.com/haresh") == "https://leetcode.com/haresh/"

def test_extract_hackerrank_url():
    assert extract_hackerrank_url("My hackerrank is https://www.hackerrank.com/haresh") == "https://www.hackerrank.com/haresh"
    assert extract_hackerrank_url("My hackerrank is hackerrank.com/haresh") == "https://www.hackerrank.com/haresh"
    assert extract_hackerrank_url("My hackerrank is https://hackerrank.com/haresh/") == "https://www.hackerrank.com/haresh"

def test_invalid_urls_rejected():
    assert verify_leetcode_profile("javascript:alert(1)")["status"] == "invalid_url"
    assert verify_leetcode_profile("https://127.0.0.1/u/haresh")["status"] == "invalid_url"
    assert verify_leetcode_profile("https://my-own-domain.com/haresh")["status"] == "invalid_url"
    
    assert verify_hackerrank_profile("data:text/html,haresh")["status"] == "invalid_url"
    assert verify_hackerrank_profile("http://localhost:8080/haresh")["status"] == "invalid_url"
    assert verify_hackerrank_profile("https://www.fakedomain.com/haresh")["status"] == "invalid_url"

@patch("app.services.external_verification.requests.post")
def test_verify_leetcode_profile(mock_post):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "data": {
            "matchedUser": {
                "username": "candidate",
                "profile": {
                    "ranking": 1850
                },
                "submitStats": {
                    "acSubmissionNum": [
                        {"difficulty": "All", "count": 523}
                    ]
                }
            }
        }
    }
    mock_post.return_value = mock_resp
    
    result = verify_leetcode_profile("https://leetcode.com/candidate", claims=["500+ solved", "rating 1850", "rating 2100", "700 solved"])
    
    assert result["status"] == "verified"
    assert result["solved"] == 523
    assert result["rating"] == 1850
    assert len(result["claims_verification"]) == 4
    
    cv1 = result["claims_verification"][0]
    assert cv1["claim"] == "500+ solved"
    assert cv1["status"] == "VERIFIED"
    
    cv2 = result["claims_verification"][1]
    assert cv2["claim"] == "rating 1850"
    assert cv2["status"] == "VERIFIED"
    
    cv3 = result["claims_verification"][2]
    assert cv3["claim"] == "rating 2100"
    assert cv3["status"] == "INCONSISTENCY"
    
    cv4 = result["claims_verification"][3]
    assert cv4["claim"] == "700 solved"
    assert cv4["status"] == "INCONSISTENCY"

@patch("app.services.external_verification.requests.post")
def test_verify_leetcode_unavailable(mock_post):
    mock_resp = MagicMock()
    mock_resp.status_code = 404
    mock_post.return_value = mock_resp
    
    result = verify_leetcode_profile("https://leetcode.com/candidate")
    assert result["status"] == "not_found"

@patch("app.services.external_verification.requests.get")
def test_verify_hackerrank_profile(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "models": [
            {"badge_name": "Python", "stars": 5},
            {"badge_name": "Problem Solving", "stars": 3}
        ]
    }
    mock_get.return_value = mock_resp
    
    result = verify_hackerrank_profile("https://hackerrank.com/candidate", claims=["5-star Python", "6-star Python"])
    
    assert result["status"] == "verified"
    assert result["python_stars"] == 5
    assert len(result["claims_verification"]) == 2
    
    cv1 = result["claims_verification"][0]
    assert cv1["claim"] == "5-star Python"
    assert cv1["status"] == "VERIFIED"
    
    cv2 = result["claims_verification"][1]
    assert cv2["claim"] == "6-star Python"
    assert cv2["status"] == "INCONSISTENCY"

def test_verify_linkedin_profile():
    result = verify_linkedin_profile("https://www.linkedin.com/in/haresh")
    assert result["status"] == "restricted"
    assert result["valid_url"] is True
