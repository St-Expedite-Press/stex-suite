# Frige uploads through MarkItDown

**Date:** November 24, 2026. **Scope:** the hosted VM, with synthetic files
only. The owner asked that every upload use the MarkItDown MCP server, and
authorized the merge, provisioning, acceptance and switch-over.

Before this change, Frige accepted PDF and Word attachments but extracted
text only from plain-text types. A PDF stayed at "Excerpt unavailable", and
Igor answered that nothing was attached. Now every upload is converted to
Markdown by Microsoft's stock `markitdown-mcp` server. The author reviews
and approves the text as before, and Igor reads only approved excerpts.

## Releases

| Release | Revision | Content |
| --- | --- | --- |
| stex-suite PR 20 | `1350391` | The converter service `apps/frige/src/document_convert.py`, the Frige client, per-file conversion with **Convert to text**, and tests |
| Pantheon generation 2 | `1350391` | Clean build (`dirty: false`), installed with the rollback-capable installer |
| stex-igor PR 12, Igor generation 22 | `3da9e6e` | Converter unit, Frige drop-in, pinned packages and runbook. No Igor code change |
| stex-igor PR 13 | open | Adds `AF_NETLINK` to the converter unit. The VM already runs this unit |

## Design

- Frige stores the upload, then the workstation converts each file in its
  own request. Each conversion runs outside the book's attachment lock and
  is applied only if the record is unchanged and has no text. Converted or
  approved text is never replaced.
- The converter starts the stock server for each upload. It checks that the
  server offers exactly `convert_to_markdown`, and sends the bytes only as a
  `data:` URI. Each upload has a 60-second limit and a 600,000-byte output
  limit, and the process group is killed afterwards.
- The unit has a dynamic user, a private network, no view of the books,
  STEX state, Hermes or credentials, 1 GB of memory and one CPU. Only
  `stex-convert`, which Frige joins through its drop-in, can open the socket.
- If the converter is down, plain-text files are read as UTF-8. PDF and
  Word files show **Conversion failed**, and **Convert to text** retries
  them.
- The packages are the CPython 3.11 bundle from the 2026-11-23 staging.
  Its archive SHA-256 `92f367e8…5124e5` was checked again before extraction.

## Verification

- **Tests:**
  - Local `corepack pnpm test`: 373 passed, 1 skipped.
  - In CI on Linux, all four conversion tests passed. One runs the real
    converter service against a stand-in MCP server and covers the
    data-URI-only rule, refusal of an unexpected tool, empty output, the
    time limit (the hung process is killed) and the type allowlist.
- **Independent review:** one round. It found no path to a file or URL, no
  path escape, no overwrite of approved text and no XSS. Its medium findings
  were fixed: the long request holding the lock (now one request per file),
  message ordering, the converter-outage fallback and long file names. Its
  low findings were fixed or documented.
- **VM acceptance:** all checks passed with synthetic files.

| Area | Result |
| --- | --- |
| Isolation | The converter's namespace has only `lo`. `/var/lib/stex-studio`, `/var/lib/stex`, `/etc/stex` and `/var/lib/hermes` are empty for it. The socket is `660 stex-convert`. Neither `nobody` nor Frige's user without the group could connect |
| Conversion | A synthetic PDF converted in 3.4 s, a DOCX with an accented word in 2.9 s, and Markdown with double spaces preserved in 2.9 s. A 300-page PDF converted in 3.9 s. `.exe` was refused with 415, and a malformed PDF returned a result without failing |
| Logs | One line per upload with an outcome code, the extension and the byte count. No traceback and no seccomp denial |
| Frige | Frige's user with `stex-convert` converted through the Node client. After the drop-in, Frige is active, holds the group and has the socket setting, and Pantheon answers |

The first start crash-looped. On Python 3.11, the startup interface check
needs `AF_NETLINK`, which the unit did not allow. Frige was not switched
over until the corrected unit passed. The code now refuses with exit 78
instead of a traceback if that check cannot run.

## Limits

- No conversion of a real manuscript was made during verification.
  Attachments uploaded before the change show **Convert to text** for the
  author to run.
- Igor reads the first 6,000 characters of an approved excerpt. Longer
  documents are converted in full, but only that opening reaches a turn.
- A scanned PDF has no text layer and shows **No readable text**. OCR is
  not enabled.
