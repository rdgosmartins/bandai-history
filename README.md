# Bandai TCG Results List

This is a simple script to compile all your results from the Bandai TCG Plus app. This is a WIP.

## Disclaimer

Even though this script makes only one request per second and uses good practices, this is an *unauthorized* used of Bandai's API. Use it at your own risk, I'm not responsible if you get your bandai account banned.


## How to use

1. Clone this repo.

2. Install your dependencies (TODO: add dependencies)

```
pip install -r requirements.txt
```

3. Duplicate the `.env.example` file and name it `.env`. Add your bearer token from the app.

4. Run the script

```
python3 bandai_history
```


### Options

Since this script saves every tournament as a json file under `events`, you can pass the `-s` flag after the first time to skip the events listing.


## Notes, Known Issues, TODOS:

- This script does not compute events with 0 rounds. This may cause a discrepancy in the total number of events and the sum of the results

- This script does not consider each game on your app individually
