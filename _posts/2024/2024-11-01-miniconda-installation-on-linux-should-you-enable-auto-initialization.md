---
layout: post
title: Miniconda Installation on Linux - Should You Enable Auto Initialization?
date: 2024-11-01 12:30:00 +0800
published: true #false or true
categories: ML
media_subpath: /assets/media/2024/miniconda-installation-on-linux/
image: anaconda.webp
tags: [anaconda, miniconda]
---


## **During Miniconda Installation**

When prompted:

```bash
Do you wish to update your shell profile to automatically initialize conda?
This will activate conda on startup and change the command prompt when activated.
If you'd prefer that conda's base environment not be activated on startup,
   run the following command when conda is activated:
   
conda config --set auto_activate_base false

You can undo this by running conda init --reverse $SHELL? [yes|no]
[no] >>>
```

Should You Enable Auto Initialization?

The answer is: it doesn't really matter. 
Whether you choose "Yes" or "No" during installation, you can always change this setting later. Below is a guide to help you understand the differences and how to adjust the initialization settings at any time.


### **If You Choose "Yes"**
- **What It Means:**
  - Conda will modify your shell configuration file (e.g., `~/.bashrc`) to automatically initialize Conda whenever you open a new terminal.
  - The initialization block added to `~/.bashrc` looks like this:
    ```bash
    # >>> conda initialize >>>
    # !! Contents within this block are managed by 'conda init' !!
    __conda_setup="$('/home/user/miniconda3/bin/conda' 'shell.bash' 'hook' 2> /dev/null)"
    if [ $? -eq 0 ]; then
        eval "$__conda_setup"
    else
        if [ -f "/home/user/miniconda3/etc/profile.d/conda.sh" ]; then
            . "/home/user/miniconda3/etc/profile.d/conda.sh"
        else
            export PATH="/home/user/miniconda3/bin:$PATH"
        fi
    fi
    unset __conda_setup
    # <<< conda initialize <<<
    ```

- **Effects:**
  - Conda will be ready for use in every new terminal session.
  - The **base environment** will be automatically activated on startup (prompt shows `(base)`).

- **Recommendation:**
  - To stop the **base environment** from activating automatically (but keep Conda initialized), run:
    ```bash
    conda config --set auto_activate_base false
    ```
  - This creates a `~/.condarc` file containing:
    ```yaml
    auto_activate_base: false
    ```
    Now, the terminal will initialize Conda, but you need to activate environments manually using:
    ```bash
    conda activate <environment_name>
    ```



### **If You Choose "No"**
- **What It Means:**
  - Conda will not modify your `~/.bashrc` or any shell configuration files.
  - The `conda` command will not be available automatically in your terminal. You must initialize it manually each time.

- **How to Use Conda After Choosing "No":**
  - To use Conda in a terminal session, manually activate it:
    ```bash
    source ~/miniconda3/bin/activate
    ```
    Replace `~/miniconda3` with the correct path to your Miniconda installation.
  - Once activated, you can run commands like `conda activate <environment_name>`.

- **How to Make It Auto-Initialize Later:**
  - If you change your mind and want Conda to initialize automatically:
    1. First, manually activate Conda:
       ```bash
       source ~/miniconda3/bin/activate
       ```
    2. Then, run:
       ```bash
       conda init
       ```
    3. This will add the Conda initialization block to your `~/.bashrc` file.



## **How to Disable Auto Initialization**

If Conda is already set to auto-initialize (e.g., you chose "Yes" during installation), but you now want to stop it:

- Run the following command:
  ```bash
  conda init --reverse
  ```
- **What This Does:**
  - It removes the Conda initialization block from your `~/.bashrc` file.
  - Conda will no longer auto-initialize, and the `conda` command will not be available unless you manually activate it.



## **How to Re-Enable Auto Initialization**

If you previously disabled Conda auto-initialization (e.g., by running `conda init --reverse`) and now want to re-enable it:

1. Manually activate Conda in the current session:
   ```bash
   source ~/miniconda3/bin/activate
   ```
2. Re-run the initialization command:
   ```bash
   conda init
   ```
3. Restart your terminal or reload the `~/.bashrc` file:
   ```bash
   source ~/.bashrc
   ```
4. Verify that Conda initializes automatically by running:
   ```bash
   conda --version
   ```



## **Summary**

| Action                     | Command/Result                                                                                 |
|----------------------------|-----------------------------------------------------------------------------------------------|
| **Choose "Yes"**           | Conda adds initialization code to `~/.bashrc`. Base environment is activated on startup.      |
| **Disable Base Activation**| Run `conda config --set auto_activate_base false`. Prevents `(base)` activation.               |
| **Choose "No"**            | No modifications are made to `~/.bashrc`. Conda must be manually initialized when needed.     |
| **Stop Auto Initialization**| Run `conda init --reverse`. Removes Conda initialization code from `~/.bashrc`.               |
| **Re-enable Auto Init**    | Manually activate Conda (`source ~/miniconda3/bin/activate`) and run `conda init`.            |


