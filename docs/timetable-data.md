# Timetable data, Google Maps and IRCTC

This page covers three things:

- where PAYANI's train data can come from, and how to import it;
- how the Google Maps links work, and what turning on Google's paid map would involve;
- what PAYANI does and does not do with IRCTC.

## 1. What the labels mean

Every train time in PAYANI carries one of four labels. The labels come from `ConfidenceBadge` in the frontend and from the `data.confidence` field in the API.

| Label | Meaning | Where it comes from today |
| --- | --- | --- |
| **Simulated** | Invented for this preview. The trains are not real services. | The built-in synthetic catalogue (trains 90001+, "PAYANI Sim"). It is used when no dataset is imported. |
| **Scheduled** | Taken from a published timetable. Shown with its source, publication date, import date and age. | An imported dataset (see below). |
| **Estimated** | Worked out from the timetable, for example where a train should be now if it runs exactly on time. | Pulse train pages. |
| **Verified live** | Confirmed by an authorised live-data provider. | Not used. No authorised provider is connected, so nothing is ever labelled live. |

A dataset more than 365 days old is marked **outdated**. Search results, the landing-page search, train pages and the admin page then show a warning. The warning says the timetable is historical, gives its age, and tells people to check the current schedule with Indian Railways or IRCTC. Historical data is never presented as the current schedule.

## 2. Datasets that were checked

| | DataMeet "Indian Railways Data" | data.gov.in "Indian Railways Train Time Table" |
| --- | --- | --- |
| Source | https://github.com/datameet/railways | https://www.data.gov.in/catalog/indian-railways-train-time-table |
| Publisher | Volunteers (DataMeet community). **Not official.** | Government of India, Open Government Data Platform |
| Licence | **CC0 1.0** (public domain dedication), stated in the repository | Not readable automatically: the catalogue page loads its resources with JavaScript. When you download, read the licence on the resource page (OGD Platform data is normally released under the Government Open Data License – India) and enter it at import. |
| Publication date | The data files were committed on **8 August 2016**. The repository has not been updated since. | Not readable automatically. Community references describe a resource titled "trains available for reservation as on 03.08.2015", covering about 2,800 trains. **Check the date shown on the page you download from** and enter that date. |
| Format | `stations.json` (GeoJSON points: code, name, state, zone), `trains.json` (GeoJSON: number, name, type, distance, class flags), `schedules.json` (stops: train number, station code, day, arrival, departure) | One CSV with one row per stop (train number and name, sequence, station code and name, arrival, departure, distance) |
| Coverage | National. Includes station positions. | National. No station positions and no day column. |
| Days of operation | Not published | Not published |

**Both datasets are years old.** They are useful for exploring real routes, station sequences and typical journey times. Neither is a current timetable. PAYANI imports them only as historical scheduled data, and labels them **outdated**.

Not used:

- IRCTC or NTES pages: no open licence or public API, and scraping them is not allowed.
- Scraper services that resell IRCTC data: same reason.
- "Trains at a Glance" PDFs: official, but parsing PDFs is error-prone and their reuse licence would need checking first.

## 3. Importing a dataset

Only a **Super Administrator** can import, because importing needs the `provider.manage` permission. Administrators can see the status and history.

### From the admin page (files up to 200 MB)

1. Download the dataset yourself:
   - **DataMeet:** use the green **Code → Download ZIP** button on the repository page. Upload that ZIP as it is; PAYANI finds the three JSON files inside it.
   - **data.gov.in:** download the CSV resource.
2. In PAYANI, go to **Administration → Timetable → Import a verified dataset**.
3. Choose the source and the file. For data.gov.in, also enter the publication date and the licence shown on its page. Tick the confirmation box, then choose **Validate and import**.

### From the command line (recommended for large files)

Run these in PowerShell from the `backend` folder, with the virtual environment active:

```powershell
# Check the files without touching the database
python -m payani.modules.timetable.cli validate --source datameet-railways --path C:\data\railways-master.zip

# Import (DataMeet: licence and date are already known)
python -m payani.modules.timetable.cli import --source datameet-railways --path C:\data\railways-master.zip --retrieved-on 2026-11-27 --confirm-licence

# Import (data.gov.in: enter what the resource page says)
python -m payani.modules.timetable.cli import --source data-gov-in-timetable --path C:\data\timetable.csv --published-on 2015-08-03 --licence "Government Open Data License - India" --confirm-licence

python -m payani.modules.timetable.cli status     # what search is using now
python -m payani.modules.timetable.cli withdraw   # go back to the simulated catalogue
```

The `2015-08-03` date above is only an example of the format. Use the date on the page you downloaded from.

### What happens during an import

1. **The attempt is recorded first** (status `validating`), so the history survives any failure.
2. **Every check runs in memory.** Nothing in the database changes during validation. The checks are:

| Check | Result |
| --- | --- |
| Missing train name, origin departure, destination arrival, or both times at a halt | The train is rejected (`missing_field`) |
| Unreadable time or distance | The train is rejected (`malformed_time`, `malformed_field`) |
| Station code not in the source, or not 1 to 8 capital letters | The train is rejected (`invalid_station_code`) |
| Times or distances go backwards, or the same station twice in a row, or the day goes backwards, or a journey longer than 6 days | The train is rejected (`inconsistent_sequence`) |
| The same schedule row twice, or two different stops with the same sequence number | The train is rejected (`duplicate_train`). An identical repeated CSV row is only a warning. |
| The same train or station listed twice | Warning. The first is kept. |
| A station with no position, or a position outside India | Warning. The station is kept without a position. |
| A 4-digit train number (a spreadsheet dropped its leading zero) | Warning. The zero is restored. |
| No valid trains, or **more than 25 %** of trains rejected | **The whole dataset is rejected.** |

3. **The switch is one database transaction.** Stations are added (an existing position is never overwritten). The previously imported trains are replaced, the previous import is marked `superseded`, and the new one `active`. If anything fails, the whole step is rolled back, the attempt is recorded as `failed`, and the previous timetable stays in use.
4. **Re-importing the active file changes nothing.** The attempt is recorded as `unchanged`. Files are fingerprinted with SHA-256, so it does not matter how they are packaged.
5. **The synthetic catalogue is never deleted.** Withdrawing an import brings it back immediately.
6. Each import, and each withdrawal, is written to the admin **audit log**.

Only two values are ever derived, and both are reported in the import report:

- **CSV without a day column:** a smaller clock time is read as the next day (`day_inferred`).
- **A halt with only one published time:** that time is used for both arrival and departure (`time_filled`).

Nothing else is filled in. A missing distance stays missing. In that case the sandbox cannot price that journey, and says so.

### Limits while a national dataset is active

- **Days of operation are unknown.** Neither source publishes them. Every train shows "may not run on your date".
- **Search allows at most one change when more than 400 trains are loaded.** This keeps searches over thousands of trains fast. Direct trains are always included.
- **Some trains cannot be sandbox-booked.** If the source lists no classes or no distance for a train, the sandbox explains why instead of inventing a fare.

## 4. Google Maps

### "Open in Google Maps" links (on by default, free)

Station cards on the map, journey cards and booking pages have **Google Maps** links. They use Google's public Maps URLs (https://developers.google.com/maps/documentation/urls/get-started), for example:

```
https://www.google.com/maps/search/?api=1&query=13.08270,80.27070
https://www.google.com/maps/dir/?api=1&origin=...&destination=...&travelmode=transit
```

- When a station has a position, the link uses its coordinates. Otherwise it uses "<name> railway station".
- The link opens in a new tab (`rel="noopener noreferrer"`).
- **No API key, no Google API call from PAYANI, and no cost.** Google decides the route shown; PAYANI only passes the two ends.

The code is in `frontend/src/lib/googleMaps.ts` and `backend/payani/core/maps.py`. The station API also returns a `google_maps_url` field.

### A Google-rendered map inside PAYANI (off; needs your approval)

PAYANI's own map stays **MapLibre + OpenFreeMap**, which is free and needs no key. The setting is already in place:

```
VITE_MAP_PROVIDER=google
VITE_GOOGLE_MAPS_API_KEY=...
```

Even with both set, this build **keeps using MapLibre**. No Google renderer ships yet, so nothing paid can turn on by accident. To turn Google on later:

1. **Create a Google Cloud billing account.** Google requires one even for free usage, so it needs your approval.
2. **Check the cost.** At the time of writing, India pricing gives 70,000 free Dynamic Maps loads a month, then charges **USD 2.10 per 1,000**; Maps Embed is free and unlimited. India pricing needs a billing address in India and mostly-Indian usage. Check https://mapsplatform.google.com/intl/en_in/pricing/ before enabling anything, because prices change.
3. **Restrict the browser key.** Allow only your site's domain and only the Maps JavaScript API. A browser key is visible to visitors by design.
4. **Keep server keys out of the frontend.** Never put a server key in a `VITE_` variable, and never commit `.env`.
5. **Add a Google renderer** behind `RailMap` that takes the same props. Keep MapLibre as the fallback.

## 5. IRCTC

PAYANI has **no IRCTC access** and does not pretend to:

- it does not scrape IRCTC or NTES;
- it does not automate IRCTC sign-in or CAPTCHAs;
- it does not use unofficial IRCTC APIs.

**Booking.** Real tickets are booked on the official IRCTC website. PAYANI's sandbox bookings are labelled *sandbox* everywhere, and their references start with `SBX-`. Each booking page has **Book on the official IRCTC website** with the details to enter there.

**What a real integration would need.** IRCTC sells e-tickets only through authorised partners:

- **Principal Service Providers** and their agents;
- the **Affiliate Partner** programme, which is open to technology companies registered in India.

Either is a commercial agreement you would need to pursue. The booking code already goes through a provider interface (`backend/payani/providers/booking.py`), so an authorised provider can be added there later without changing the rest of the app.
