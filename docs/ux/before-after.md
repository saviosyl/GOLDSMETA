# Before / after — mobile-first daily trader UX

## Previous problems

- Primary nav mixed Plan with Research/History; Brokers and AutoTrade competed with daily tools.
- Plan page buried levels behind research tabs.
- Raw reason codes appeared in the main UI.
- Markets (Intelligence) led with implementation jargon.
- Journal was a minimal notepad, not a review workspace.
- Help still pushed Demo broker setup as a first step.
- Execution pages looked actionable while locked.

## New solutions

- Mobile nav: **Plan · Markets · Journal · More** with grouped More sheet.
- Desktop nav grouped: Daily / Research / Tools / Account / Admin.
- Plan fold: primary card → stage stepper → confirmation → checks → range → alternative → **View research**.
- Reason codes translated to plain English; raw codes only in Advanced diagnostics.
- Markets leads with plain-English context + **View today’s plan**.
- Journal filters + lesson learned + History archive link.
- Help rewritten around today’s manual workflow.
- Brokers / AutoTrade show **Execution disabled** banner first.

## Mobile before → after

| Area | Before | After |
| --- | --- | --- |
| Bottom nav | Plan / Research / History / More | Plan / Markets / Journal / More |
| Plan order | Research tabs before checks | Action levels + stages before research |
| Codes | ENTRY_EQUALS_STOP visible | “Entry and stop are too close.” |

## Desktop before → after

| Area | Before | After |
| --- | --- | --- |
| Sidebar | Flat Plan/Research/History + More list | Grouped Daily / Research / Tools / Account / Admin |
| Email | Visible in sidebar foot | Profile menu (mobile) / topbar desktop |
