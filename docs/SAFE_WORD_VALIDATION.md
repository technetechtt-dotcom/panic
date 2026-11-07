# Safe Word validation campaign

Guardian's current Safe Word path must not be promoted as a trained multi-accent model until a labelled field campaign produces measured false-acceptance and false-rejection results.

## Result format

Record one JSON object per line:

```json
{"expected":true,"detected":true,"device":"Samsung A54","language":"Setswana","condition":"whisper","noise":"vehicle"}
```

- `expected=true`: the enrolled safe phrase was deliberately spoken.
- `detected=true`: Guardian raised the Safe Word detection.
- Negative samples must include speech that is not the Safe Word, similar phrases, music/TV and ordinary conversation.

Calculate results:

```bash
node services/api/scripts/safe-word-benchmark.mjs safe-word-results.jsonl
```

The report provides overall and grouped FAR, FRR, precision and recall.

## Minimum campaign matrix

Test multiple consenting speakers across:
- English
- Afrikaans
- Setswana
- isiXhosa
- isiZulu
- Sesotho

Conditions:
- normal speech
- whisper
- stressed/urgent speech
- phone in hand
- phone in pocket/bag
- stationary room
- moving vehicle
- wind/outdoor environment
- music
- television/radio
- crowd/conversation
- phrases acoustically similar to the enrolled Safe Word

Device families should include the same Android OEM matrix used for Guardian field validation.

## Release gate

Do not replace the current production detector simply because a neural KWS model scores well on training data. A candidate should:
1. run in shadow mode;
2. be evaluated on held-out users/devices/noise;
3. have measured FAR/FRR thresholds approved for the pilot;
4. preserve fully on-device operation for the core detection path;
5. never gate manual/volume/duress SOS;
6. have a rollback path.

Store only consented benchmark material and follow the project's privacy/retention policy. Do not commit raw participant audio to the public repository.
