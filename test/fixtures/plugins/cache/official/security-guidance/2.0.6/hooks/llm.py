# Minimal fixture standing in for the plugin's SDK-spawning source. The resolver
# only harvests prompt anchors from plugins whose source imports the Agent SDK.
from claude_agent_sdk import ClaudeAgentOptions, query  # noqa: F401


def build_prompt(diff: str) -> str:
    return (
        "Review this change for security vulnerabilities.\n\n"
        "Changed files (you may Read these and any other file in the repo):\n"
        + diff
    )
