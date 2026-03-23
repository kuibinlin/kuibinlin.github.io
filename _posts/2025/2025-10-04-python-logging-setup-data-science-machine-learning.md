---
layout: post
title: Python Logging Setup for Data Science and Machine Learning
description: Configure Python logging properly for data science projects to control library noise and maintain consistent output.
date: 2025-10-04 00:10:00 +0800
published: true #false or true
categories: machine-learning
toc: true
media_subpath: /assets/media/2025/python-logging-setup-data-science-machine-learning
image: logging.png
tags: [machine-learning, logging, python]
---

### Background

In data science and machine learning, many libraries **emit lots of logs**—like `pandas`, `numpy`, `scikit-learn`, `PyTorch`, and `TensorFlow`. By default they all send log records to one shared place called the **root logger**.

If you use `logging.basicConfig(...)` or `logging.info(...)` without making your own logger, you’re using that root logger. Change its level to `DEBUG`, and every library **starts emitting verbose output**—which can flood your screen.

**Better plan:** make your **own named logger** for your project.

* You control what shows up.
* Your messages stay clean and consistent.
* Library noise doesn’t take over your console or log files.

### Logging levels

* `logger.debug(...)` — **fine-grained details** for diagnosing issues (noisy; great during development).
* `logger.info(...)` — **normal operation** updates (start/stop, milestones, counts).
* `logger.warning(...)` — **something unexpected** happened, but the app can continue (deprecated input, slow response).
* `logger.error(...)` — **operation failed** or data is unusable, but the process/app may keep running.
* `logger.exception(...)` — same as `error` **plus the traceback**. Use **inside an `except` block** to capture the stack trace automatically.

> Levels are ordered `DEBUG < INFO < WARNING < ERROR`.

---

## Why not just use the built in logging everywhere

Yes, we **are** using Python’s `logging`—but it needs to be configured properly so logs stay consistent and libraries don’t overwhelm your output. If each file sets it up on its own, or you rely on the unnamed **root logger**, you run into problems:

* ❌ Inconsistent formats and levels
* ❌ Root changes make **third-party libraries** noisy
* ❌ Console and file output hard to keep aligned

By default, calling `logging.basicConfig(...)` or `logging.info(...)` without a named logger uses the **root logger**. Since most libraries also log there, any change you make affects them too—often flooding your console with messages you don’t want.


### Example 1: Making third-party libraries too noisy

Say you’re using **requests** (a HTTP library):

```python
# main.py
import logging
import requests

# You configure root logger to DEBUG
logging.basicConfig(level=logging.DEBUG)

logging.info("Starting program...")
requests.get("https://example.com")
logging.info("Finished!")
```
Output:
```
INFO:root:Starting program...
DEBUG:urllib3.connectionpool:Starting new HTTPS connection (1): example.com
DEBUG:urllib3.connectionpool:https://example.com:443 "GET / HTTP/1.1" 200 1256
INFO:root:Finished!
```

**What happens?**

Because `requests` (and the lower-level `urllib3`) use the root logger, your DEBUG setting makes them *very chatty*.

Suddenly your console is full of `urllib3` connectionpool logs that you didn’t ask for — because you raised the root logger to `DEBUG`.

---

### Example 2: Avoiding the noise with your own logger

Define a **named logger** in `logger.py`:

```python
import os   # For working with directories and file paths
import sys  # To access system streams like stdout (the console)
import logging  # Python's built-in logging library

# Define how each log message should look
# Example: 2025-10-01 12:34:56,789 - INFO - logger name - mymodule - This is a log message
logging_str = "%(asctime)s - %(levelname)s - %(name)s - %(module)s - %(message)s"

# Name of the folder where log files will be stored
# IMPORTANT: This is relative to the directory where you run the script
log_dir = "logs"

# Full path to the log file: logs/logging.log
log_filepath = os.path.join(log_dir, "logging.log")

# Make sure the logs/ directory exists.
# If it doesn't exist, create it.
os.makedirs(log_dir, exist_ok=True)

# Configure the logging system:
logging.basicConfig(
    level=logging.INFO,          # Log all messages at INFO level and above (INFO, WARNING, ERROR, etc.)
    format=logging_str,          # Use the formatting string defined above
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(log_filepath), # Write logs to logs/logging.log file
        logging.StreamHandler(sys.stdout)  # Also print logs to the console (standard output)
    ]
)

# Create a named logger you can use in your other modules
# Example: from src import logger
#          logger.info("Starting data ingestion...")
logger = logging.getLogger("mllogger")
```

And use it, let say in `main.py`:

```python
from logger import logger
import requests

logger.info("Starting program...")
requests.get("https://example.com")
logger.info("Finished!")
```

Output:

```
2025-10-04 12:34:56 - INFO - mylogger - main - Starting program...
2025-10-04 12:34:57 - INFO - mylogger - main - Finished!
```

No noisy `urllib3` logs, because you only raised the level for **your project logger** — not the root logger.

---

### **Let me explain again with an analogy:**

Imagine you’re running a busy kitchen.

* If every cook just **shouts** what they’re doing (“chopping onions!”, “soup boiling!”), the room is noisy and nothing is written down. Walk away for a minute and you miss everything. That’s **`print()`**.
* If each cook keeps their **own private notebook**, some write times, some don’t, some scribble in different formats. When the head chef asks “what went wrong with the soup yesterday?”, you can’t piece it together. That’s **ad-hoc `logging`** scattered across files.
* Instead, the kitchen keeps **one shared diary** with a simple template: time, severity, who wrote it, and the message. You can watch today’s page live or flip back to last week. That’s your **`logger.py`**.

`logger.py` gives your project one consistent “kitchen diary” so you can see what happened, when, and where—both on screen and saved to disk.

---

## What is `logger.py` for?

`logger.py` is a **project-wide Python logging configuration**. This one gives you a consistent starting point, and you can turn features on or off as you need.

**With `logger.py`, you can:**

* **Log to multiple places** — send output to your terminal **and** to a log file (e.g. `logs/logging.log`). You can choose the folder where logs are stored, so everything gets saved in one place.
* **Include useful context** — add timestamp, level (`DEBUG/INFO/WARNING/ERROR`), module name, and the message: 
    ```
    2025-10-04 14:32:11 - INFO - mylogger - main - Finished processing user input
    ```
* **Keep formatting consistent** — make logs readable and searchable across every module.
* **Tune verbosity per module** — bump one package to `DEBUG` while keeping others at `INFO`.
* **Rotate files** (optional) — prevent log files from growing without bound.

---
## Tune Verbosity per Module

The `logger.py` module defines the project-wide default via `mllogger`. Every child logger (e.g., `mllogger.data_ingestion`, `mllogger.training`) inherits this level unless overridden with `setLevel()`. The following examples demonstrate three targeted behaviors: (1) using the base default everywhere, (2) increasing verbosity for ingestion only, and (3) reducing verbosity for training only.

In `logger.py`, you set:

```python
logging.basicConfig(level=logging.INFO, ...)
logger = logging.getLogger("mllogger")
```

So by default, all loggers (base + children) only show **INFO and above**.

---

### 1. Just use the base logger (project-wide default)


```python
# main.py
from logger import logger

logger.debug("Debug: won’t show")     # Wil not show, Too low
logger.info("Info: this will show")
logger.warning("Warning: this will show")
```

**Output**

```
2025-10-04 12:00:00 - INFO - mylogger - main - Info: this will show
2025-10-04 12:00:01 - WARNING - mylogger - main - Warning: this will show
```

---

### 2. More verbose for ingestion

Now suppose you only want **extra detail for ingestion**, without drowning the rest.

```python
# ingestion.py
from logger import logger
import logging

# Create a child logger for the data_ingestion module
ingest_log = logger.getChild("data_ingestion")

# Be chatty for ingestion
ingest_log.setLevel(logging.DEBUG)

ingest_log.debug("Read 100 rows")      # Will show now
ingest_log.info("Ingestion finished")  # Will show
```

**Output**

```
2025-10-04 12:01:00 - DEBUG - mylogger.data_ingestion - ingestion - Read 100 rows
2025-10-04 12:01:01 - INFO - mylogger.data_ingestion - ingestion - Ingestion finished
```

Notice: `DEBUG` messages are visible **only** for `data_ingestion`.

---

### 3. Less verbose for training

Maybe training is too noisy and you only want **warnings or worse**.

```python
# train.py
from logger import logger
import logging

# Create a child logger for the training module
train_log = logger.getChild("training")

# Only log WARNING and above for training
train_log.setLevel(logging.WARNING)

train_log.info("Training started")        # Will NOT show
train_log.warning("Loss diverging")       # Will show
train_log.error("Training crashed!")      # Will show
```

**Output**

```
2025-10-04 12:02:00 - WARNING - mylogger.training - train - Loss diverging
2025-10-04 12:02:01 - ERROR - mylogger.training - train - Training crashed!
```

---

## Summary


* **Root logger changes = global changes** (your code + libraries).
* **Named logger changes = scoped changes** (just your project).


* **Base logger (`mylogger`) in `logger.py`** sets the global “volume knob” (default INFO).
* **Child loggers** (`mylogger.data_ingestion`, `mylogger.training`) can override their own knob:

  * Turn **up** sensitivity → `setLevel(DEBUG)`
  * Turn **down** sensitivity → `setLevel(WARNING)`

---


