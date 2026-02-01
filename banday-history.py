from collections import defaultdict
from pathlib import Path
import json
import os
import requests
import time

EVENTS_DIR_PATH="events"

"""
Bearer token to authenticate requests to the bandai-plus-tcg api.
TODO: See if there are public endpoints to check event data OR sign in without having to 
manually fill the token in this script.
"""
req_headers = {
    'X-Authentication': ''
}

"""
Fetch all events in the player's history.
TODO: add logic to make paginated requests. For now, 1_000 events should be more than enough.
"""
def fetch_event_ids():
    url = 'https://api.bandai-tcg-plus.com/api/user/my/event?favorite=0&game_title_id=&limit=1000&offset=0&past_event_display_flg=1&selected_tab=3'
    response = requests.get(url, headers=req_headers)
    print(f"Fetch event ids status Code: {response.status_code}")

    if response.status_code == 200:
        # TODO: check if event data already exists locally
        event_data = response.json()['success']['events']
        
        event_ids = []
        for event in event_data:
            event_ids.append(event['id'])

        # print(event_ids)
        return event_ids
    else:
        print("Something went wrong when fetching your event history")

"""
Fetch data from a single event
"""
def fetch_single_event_data(event_id):
    filename = os.path.join(EVENTS_DIR_PATH, str(event_id))
    if Path(filename).is_file():
        print(f"Event with ID {event_id} data already exists locally")
        with open(filename, "r") as json_file:
            return json.load(json_file)

    url = f"https://api.bandai-tcg-plus.com/api/user/event/{event_id}/history"
    response = requests.get(url, headers=req_headers)
    time.sleep(1)
    # print(f"Fetching event {event_id} status Code: {response.status_code}")

    if response.status_code == 200:
        response_data = response.json()['success']
    
        with open(filename, "w") as json_file:
            json.dump(response_data, json_file, indent=4)
        return response_data
    else:
        print(f"Something went wrong while fetching data for {event_id}")


"""
Returns (wins, losses) for the tournament
"""
def tabulate_single_event(event_data):
    wins = 0
    losses = 0
    
    rounds = event_data['rounds']
    for round in rounds:
        if round['is_win']:
            wins += 1
        else:
            losses += 1

    return (wins, losses)


"""
Count every possible result in the player's history (e.g: player had 3 3-1s, etc.)
"""
def tabulate_results(events_data):
    player_results = defaultdict(int)
    player_results_by_losses = defaultdict(int)

    for event in events_data:
        result = tabulate_single_event(event)
        player_results[result] += 1
    sorted_results = dict(sorted(player_results.items(), key=lambda x: x[0][1]))

    for result, qty in sorted_results.items():
        # Skipping tournaments that stores asked us to apply just for the record
        if result[0] == 0 and result[1] == 0: continue

        print(f"{result[0]}-{result[1]}: {qty}")
        player_results_by_losses[result[1]] += qty

    print("=============================")
    for result, qty in player_results_by_losses.items():
        print(f"X-{result}: {qty}")


"""
Fetch each event from player's history and save them in json files
"""
def fetch_data():
    event_ids = fetch_event_ids() 
    no_events = len(event_ids)

    print(f"You have {no_events} in your history")

    event_data = []
    for idx, event_id in enumerate(event_ids):
        print(f"Fetching event {idx + 1} of {no_events} (ID {event_id})")
        # TODO: handle errors
        event_data.append(fetch_single_event_data(event_id))

    return event_data
    
if __name__ == "__main__":
    # TODO: handle errors
    if not os.path.isdir(EVENTS_DIR_PATH):
        os.mkdir("events")

    event_data = fetch_data()
    print("==========")
    tabulate_results(event_data)

