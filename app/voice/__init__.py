"""
Voice layer for the encounter: text-to-speech ONLY.

    student speech --(browser Web Speech API)--> text
      -> existing encounter engine take_turn()  (unchanged; it alone decides what the patient says)
      -> reply text --(this package: /tts)--> audio

We never use ElevenLabs' conversational agents or any service that generates the patient's
words, and we never record or store audio.
"""
