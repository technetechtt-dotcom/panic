# POPIA operating procedure

This is the operating procedure wired into Guardian. It is not a legal opinion, a registration with the Information Regulator, or a claim that the product complies with the Protection of Personal Information Act.

## Roles

- The person using the phone is the data subject for their account, location, and incident.
- An operator with incident access can read an open incident, including location.
- A supervisor can read the audit log and change non-administrator roles.
- An administrator can assign the administrator role.
- A responder sees assigned incidents and can report that the person was located.

## What is collected

Account email and display name, device details, distress and location during an incident, guardian names, emergency profile fields the person types, and evidence the person captures. Passwords are stored as hashes. Freeze PINs stay on the phone.

## Subject requests

- Export: `GET /api/v1/users/me/export` returns the profile, guardian names, device labels, and incident ids. It does not return passwords, PINs, or evidence bytes.
- Erase: `POST /api/v1/users/me/erase` requires the password, removes guardians, the emergency profile, and operator MFA, and anonymizes the account. Incident rows stay so an open emergency is not deleted by that call.

## Day-to-day rules

- Do not copy evidence bytes into chat, email, or a ticket. Use the incident evidence viewer.
- Test incidents stay out of the summary counts.
- A suspected breach is written up by a supervisor and taken to the responsible party. The platform page does not notify a regulator.

## Still required outside this repo

A lawyer still has to decide the responsible party, the section 18 notice, operator agreements, retention periods, and whether a monitoring service in South Africa needs a further filing. Those decisions are not encoded here.
