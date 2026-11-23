# TRMNL plugins

Source for the [TRMNL](https://trmnl.com) e-ink display plugins I've built. Each folder holds one plugin in TRMNL's import/export layout:

- `settings.yml`: plugin settings and installer fields
- `full.liquid`, `half_horizontal.liquid`, `half_vertical.liquid`, `quadrant.liquid`: markup for each layout, plus `shared.liquid` for code they share
- `polling_url.liquid`: the polling URL(s), where it's too long to sit in `settings.yml`
- `transform.js`: data transform that runs in TRMNL's serverless Node runtime
- `previews/`: screenshots. Files named `*-local.png` are approximate local renders; real devices dither better.

None of these plugins need an API key or an account.

| Plugin | What it shows | TRMNL recipe |
|---|---|---|
| [Ann Arbor Bus Arrivals](ann-arbor-bus-arrivals/) | Real-time bus arrivals for up to four AAATA/TheRide stops in Ann Arbor and Ypsilanti | In TRMNL review |
| [Wastewater Watch](wastewater-watch/) | Weekly SARS-CoV-2, influenza A and RSV wastewater levels for one US treatment site, from CDC NWSS | Coming soon |
| [Virology Paper of the Day](virology-paper-of-the-day/) | One new virology paper a day from bioRxiv and virology journals, via Europe PMC | Coming soon |
| [PDB Structure of the Day](pdb-structure-of-the-day/) | One structure a day from the latest weekly Protein Data Bank release | Coming soon |
| [Art Forms in Nature](art-forms-in-nature/) | A plate from Ernst Haeckel's *Kunstformen der Natur* with a short natural history note | Coming soon |
| [100 Years Ago Today](hundred-years-ago/) | The front page of a newspaper printed 100 years ago today, from the Library of Congress's Chronicling America | Not published |
| [Amtrak Station Board](amtrak-station-board/) | Upcoming Amtrak trains at any station, with scheduled and expected times, via the unofficial Amtraker API | Not published |

Recipe links will be added here once TRMNL lists each one in its public directory. Until then you can rebuild a plugin by hand: create a private plugin on trmnl.com and paste in the files, or use TRMNL's plugin import.

## Using or adapting these

Pick **Install** on a recipe to get updates, or **Fork** to change it. The code here is the same as what each recipe runs.

These plugins are unofficial. They are not affiliated with or endorsed by TRMNL, AAATA/TheRide, CDC, Europe PMC, RCSB PDB, Wikimedia, the Library of Congress, Amtrak or Amtraker. Each data source keeps its own terms; see the plugin's README.

## Issues

Please open a [GitHub issue](../../issues) for bugs or ideas.

## License

[MIT](LICENSE). Data and images the plugins fetch belong to their sources and are not covered by this license.
