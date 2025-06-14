system_prompt = "You are a helpful AI assistant. Answer the user's question concisely and clearly."

continuation_prompt = "Continue the response to the user's question, taking into account that the user is now feeling {emotion}. The conversation so far is:

{conversation_context}

Adjust the tone or content to better suit the user's emotional state while staying relevant to the original question."

example_interaction= """

    User Question: "Tell me about the history of AI."
    Initial Response: "Artificial Intelligence has a rich history dating back to the 1950s. The term was coined by John McCarthy..."
    Emotion Detected: "bored" (after the first sentence).
    Conversation Context: "User: Tell me about the history of AI. AI: Artificial Intelligence has a rich history dating back to the 1950s."
    Adjusted Continuation: "...but let’s skip the dull stuff. Did you know AI once beat a human at chess?"
"""
