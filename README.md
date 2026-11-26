# VECTORHEART

VECTORHEART is a local workspace for research notes, hypotheses, and evidence. When these records sit in separate files, it is hard to see why a hypothesis changed. In VECTORHEART, you can read an earlier version of a hypothesis and inspect the notes, papers, and results linked to it.

## How it works

- **Notebook and Research Graph.** The Notebook and the graph use the same records. React Flow displays the links between observations, hypotheses, and evidence. The kernel stores each node's position separately, so you can rearrange the graph without changing a research record.
- **Scientific Kernel.** The Next.js interface sends requests to a local Python service built with FastAPI. This service, called the kernel, stores records and revisions in SQLite. A single database gives both views the same history and works without a separate database server.
- **Research Evolution.** The kernel records project events in order. You can follow an experiment from approval to completion in the timeline. A read-only checkpoint preserves the records and graph as they appeared when you saved it.
- **AI proposals.** A model can suggest a graph from your journal. Each interpretation cites a passage and its revision so you can check it against your own words. AI Accelerate can suggest another explanation or a test. The kernel checks the proposal format and source references. You decide which proposals to keep. Accepted proposals still need evidence.
- **Experiments.** An automated investigation can select a registered tool and propose a test. It pauses for your approval before it runs an experiment. Approval fixes the parameters for that run. The kernel checks the measurements and links the result to the hypothesis. You can trace each result to the test that produced it.
- **Literature.** The kernel searches OpenAlex and Europe PMC and checks DOIs through Crossref. It saves the publication details and any available abstract used in the analysis. You can read the same source material before you accept a link between a paper and a hypothesis.

## Run locally

Use Windows PowerShell from the repository root. You need Python 3.11 or later and Node.js with npm (22.13+ in the 22.x series, or 24+).

This single-user prototype has no sign-in. The commands below keep both services on your computer.

### 1. Install the dependencies

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements-lock.txt
npm install
```

### 2. Start the kernel

If you have an existing database, stop the kernel and back up the database before you apply migrations. The default location is `.vectorheart/kernel.sqlite3`. For a different location, set `KERNEL_DB_PATH` to the same path for both commands.

```powershell
backend/.venv/Scripts/python -m alembic -c backend/alembic.ini upgrade head
backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

### 3. Start the workspace

Open a second PowerShell terminal in the repository root. Leave the kernel running.

```powershell
npm.cmd run dev -- --hostname 127.0.0.1
```

Open the [workspace](http://localhost:3000). To inspect the kernel endpoints, open the [local API documentation](http://127.0.0.1:8000/docs).

## Try the First Heartbeat

This NumPy simulation runs without an AI key. Two models explain the same observed relationship between X and Y. When you set X to 2, model A predicts a mean of 1.6 for Y. Model B predicts 0.

1. Create a project and open **Notebook**.
2. Expand **Scientific tools & research history** and select **Try the First Heartbeat**.
3. Review the predictions and parameters under **Scientific operations**. Select **Approve**, then **Run approved experiment**.
4. Open the completed **Simulation run**. Check which predicted mean falls inside the reported 95% interval. The result applies only to the simulated system.

## Configure AI features

The journal, the simulation, and basic literature search work without a model API key. To generate a graph or use AI Accelerate, configure a provider. The kernel sends the relevant project text to that provider and keeps the API key on the server.

Create the configuration file if it does not already exist.

```powershell
if (-not (Test-Path backend/.env)) {
    Copy-Item backend/.env.example backend/.env
}
```

In `backend/.env`, set a key and a model ID available to your account.

| Provider | API key | Model ID |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_DEFAULT_MODEL` |
| Google Gemini | `GEMINI_API_KEY` | `GEMINI_DEFAULT_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_DEFAULT_MODEL` |

Restart the kernel. In project settings, select the provider for each task or use **Automatic** to follow `VECTORHEART_PROVIDER_PRIORITY`. Keep `backend/.env` out of version control.

## Development checks

Run these commands from the repository root after you install the dependencies. The tests use temporary databases and model fixtures. The workspace integration test starts its own kernel and needs port `8002` to be free.

```powershell
backend/.venv/Scripts/python -m pytest backend/tests -q
npm test
npm run lint
npm run typecheck
npm run build
```

## Technical documentation

- [Scientific Kernel and import of existing browser data](docs/SCIENTIFIC_KERNEL.md)
- [Research Intelligence and model configuration](docs/RESEARCH_INTELLIGENCE.md)
- [Research Graph, corrections, and automated investigations](docs/STAGE3.md)
- [Literature search and source verification](docs/STAGE4.md)
- [Research Evolution and checkpoints](docs/RESEARCH_EVOLUTION.md)
