"""Native SSH/SFTP deployment helper. Credentials stay in ignored .private/."""
import argparse
import json
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent


def connect():
    config = json.loads((ROOT / ".private/ssh.json").read_text(encoding="utf-8"))
    client = paramiko.SSHClient()
    known = ROOT / ".private/known_hosts"
    if known.exists():
        client.load_host_keys(str(known))
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        config["host"], username=config["username"], password=config["password"],
        timeout=20, auth_timeout=20, banner_timeout=20, look_for_keys=False, allow_agent=False,
    )
    client.save_host_keys(str(known))
    client.get_transport().set_keepalive(15)
    return client, config


def run(client, config, script, sudo=False):
    needs_password = False
    if sudo:
        _, check, _ = client.exec_command("sudo -n true")
        needs_password = check.channel.recv_exit_status() != 0
    command = ("sudo -k -S -p '' bash -s" if needs_password else "sudo -n bash -s") if sudo else "bash -s"
    channel = client.get_transport().open_session(timeout=20)
    channel.exec_command(command)
    data = ((config["password"] + "\n") if needs_password else "") + script
    channel.sendall(data.encode("utf-8"))
    channel.shutdown_write()
    while True:
        for ready, receive, output in [
            (channel.recv_ready, channel.recv, sys.stdout),
            (channel.recv_stderr_ready, channel.recv_stderr, sys.stderr),
        ]:
            while ready():
                output.write(receive(65536).decode("utf-8", errors="replace").replace(config["password"], "[redacted]"))
                output.flush()
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        time.sleep(0.08)
    return channel.recv_exit_status()


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="mode", required=True)
    execute = commands.add_parser("run")
    execute.add_argument("file", type=Path)
    execute.add_argument("--sudo", action="store_true")
    for name in ["put", "get"]:
        transfer = commands.add_parser(name)
        transfer.add_argument("source")
        transfer.add_argument("destination")
    args = parser.parse_args()
    client, config = connect()
    try:
        if args.mode == "run":
            return run(client, config, args.file.read_text(encoding="utf-8-sig"), args.sudo)
        with client.open_sftp() as sftp:
            if args.mode == "put":
                sftp.put(args.source, args.destination)
                print("Uploaded", Path(args.source).name)
            else:
                sftp.get(args.source, args.destination)
                print("Downloaded", Path(args.destination).name)
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
