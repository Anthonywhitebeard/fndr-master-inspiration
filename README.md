# Inspiration Points

#Example:
<img width="382" height="1317" alt="image" src="https://github.com/user-attachments/assets/30af4a32-1a83-4e8f-9856-7875eb755cd8" />
<img width="306" height="205" alt="image" src="https://github.com/user-attachments/assets/9f64db31-b138-45c4-b68c-3cb6b9fb08fb" />


Foundry VTT v14 module for D&D5e.

Features:

- shows inspiration points for player characters in the Combat Tracker
- GM button to grant +1 inspiration
- player buttons to spend 1 inspiration for a reroll
- player button to spend 2 inspiration to reroll the latest d20 and force it to a critical result
- shared visual animations for gain and spend events on all connected clients

Notes:

- the module looks for the latest roll chat message for the actor when spending inspiration
- the critical spend requires that latest roll to contain a d20 result
