# Valorant Auto-Record

A script to automatically record your Valorant games

### Features:

 - Automatically starts/stops OBS recording when games start/stop
 - Renames the OBS output file with info from the game
 - Saves mmr and match history of players in game
 - Saves pregame, coregame, and match details
 - Saves loadout data
 - Saves websocket events (includes chat)

## Usage

 - [Download the latest release](../../releases/latest/download/Valorant-AutoRecord.exe)
 - If Windows SmartScreen pops up ("Windows protected your PC"), click "More info" then "Run anyway"
 - Run it once to generate the config file
 - Configure the application by modifying `config.json`

### Recording Rename Templates
| Template      | Description                                                     |
|---------------|-----------------------------------------------------------------|
| `{directory}` | The original directory of the recording                         |
| `{extension}` | The original file extension of the recording                    |
| `{original-name}` | The original name of the recording, not including the extension |
| `{map}`       | The map name                                                    |
| `{agent}`     | The name of the agent played                                    |
| `{queue}`     | The queue type                                                  |
| `{score}`     | The final score of the game                                     |

Example:
```
{{directory}}/{{original-name}} {{queue}} {{map}} {{agent}} {{score}}{{extension}}
```
will get turned into
```
D:\recording\obs-output\2024-01-20 19-29-43 swiftplay Lotus Cypher 4-5.mkv
```
(depending on your OBS settings for directory and original name)
