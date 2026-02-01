import argparse
import os
from api_requests import fetch_data
from tournament_data import tabulate_results

EVENTS_DIR_PATH="events"

"""
Bearer token to authenticate requests to the bandai-plus-tcg api.
TODO: See if there are public endpoints to check event data OR sign in without having to 
manually fill the token in this script.
"""
BEARER_TOKEN = ""
    
if __name__ == "__main__":
    # TODO: handle errors
    if not os.path.isdir(EVENTS_DIR_PATH):
        os.mkdir("events")

    cli_arg_parser = argparse.ArgumentParser(description="Simple script to compile your results from the bandai plus tcg app.")
    cli_arg_parser.add_argument("-s", "--skip-listing", action="store_true", help="skip request to list events, work with data already requested")
    
    args = cli_arg_parser.parse_args()

    event_data = fetch_data(BEARER_TOKEN, EVENTS_DIR_PATH, args.skip_listing)
    print("==========")
    tabulate_results(event_data)

