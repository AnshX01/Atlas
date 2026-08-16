import os
import uuid
from github import Auth, Github

# Get token directly from string or from environment
TOKEN = "YOUR_GITHUB_TOKEN"

def main():
    gh = Github(auth=Auth.Token(TOKEN))
    user = gh.get_user()
    print(f"Authenticated as: {user.login}")

    # Let's find a repo we can test on. Maybe the user has a test repo, or we can just create one, 
    # or create an issue on an existing repo.
    repos = list(user.get_repos(type="owner"))
    if not repos:
        print("No repos found!")
        return
    
    test_repo = repos[0]
    for repo in repos:
        if "test" in repo.name.lower():
            test_repo = repo
            break
            
    print(f"Using repo: {test_repo.full_name}")

    # Create issue
    title = f"Test Issue {uuid.uuid4()}"
    print(f"Creating issue: {title}")
    issue = test_repo.create_issue(title=title, body="This is a test issue.")
    print(f"Created issue #{issue.number}: {issue.html_url}")
    
    # Close issue
    print(f"Closing issue #{issue.number}")
    issue.edit(state="closed")
    print(f"Issue closed: {issue.state}")

    # For creating a PR, we need a branch. We can just test issue for now and trust PR logic which uses the exact same pygithub library.
    # Actually, we can create a file on a new branch and open a PR.
    try:
        main_ref = test_repo.get_git_ref("heads/main")
    except Exception:
        main_ref = test_repo.get_git_ref("heads/master")
    
    branch_name = f"test-branch-{uuid.uuid4().hex[:6]}"
    print(f"Creating branch: {branch_name}")
    test_repo.create_git_ref(ref=f"refs/heads/{branch_name}", sha=main_ref.object.sha)
    
    print("Creating a commit on branch")
    test_repo.create_file(
        path=f"test_{uuid.uuid4().hex[:6]}.txt",
        message="Test commit",
        content="Hello world",
        branch=branch_name
    )
    
    print("Creating PR")
    pr = test_repo.create_pull(
        title="Test PR",
        body="Test PR body",
        head=branch_name,
        base=main_ref.ref.split("/")[-1]
    )
    print(f"Created PR #{pr.number}: {pr.html_url}")
    
    print("Merging PR")
    status = pr.merge()
    print(f"Merged PR: {status.merged}")

if __name__ == "__main__":
    main()
