# Architecture

How the voice demo is put together, and the three places the design is load
bearing. `docs/screenshots/voice/architecture.png` is rendered from this file:

    cd tools/screenshots
    node render-diagram.mjs ../../hackathon/agentic-voice-application/docs/architecture.md \
      ../../docs/screenshots/voice/architecture.png

```mermaid
%%{init: {'theme':'base','themeVariables':{
  'primaryColor':'#ffffff','primaryTextColor':'#1a1c1e','primaryBorderColor':'#c7c2ba',
  'lineColor':'#7c8188','fontFamily':'ui-sans-serif, system-ui, sans-serif','fontSize':'15px',
  'clusterBkg':'#f7f6f4','clusterBorder':'#c7c2ba','edgeLabelBackground':'#f7f6f4',
  'tertiaryColor':'#efedea'}}}%%
flowchart TB
  subgraph tab["One browser tab. No backend, no server of ours anywhere."]
    direction TB

    boot["main.tsx<br/><i>setupWebMCPPolyfill() at module scope,<br/>before the first render</i>"]
    registry[["document.modelContext<br/><i>native, or the polyfill</i>"]]

    subgraph scopes["Registration is scoped. The two sets never overlap."]
      direction LR
      board["Board scope, 6 tools<br/>find_matching_roles<br/>next_role<br/>open_role"]
      appl["Application scope, 9 tools<br/>fill_step, correct_field<br/>ask_for_field, prepare_submit"]
    end

    match(["matchOpenings()<br/><b>one search, two callers</b>"])
    filters["Filter bar<br/><i>what a person types,<br/>and what a tool sets</i>"]
    form["ApplicationForm<br/><i>five steps</i>"]
    person(["The person<br/><i>answers what the profile cannot</i>"])
    submit>"Submit button<br/><b>pressed only by a person</b>"]

    voice["useVoiceSession<br/><i>imports no tool definitions</i>"]
    docks["VoiceDock / TextAgentDock"]
    scripted["Scripted walkthrough<br/><i>no socket, no microphone</i>"]
  end

  subgraph live["Reached only when you type a key"]
    direction LR
    gem[("Gemini Live<br/>WebSocket, PCM")]
    oai[("OpenAI Realtime<br/>WebRTC")]
  end
  scripted["Scripted walkthrough<br/><i>no socket, no microphone</i>"]

  boot --> registry
  registry --- scopes
  board -->|"reads"| match
  board -->|"sets the filter bar,<br/>rings one card"| filters
  filters -->|"reads"| match
  appl -->|"writes"| form
  appl -->|"ask_for_field<br/>highlights one field"| person
  person -->|"says it out loud"| appl
  appl -.->|"prepare_submit<br/>moves focus only"| submit

  docks --> voice
  voice -->|"getTools()<br/>executeTool(name)"| registry
  voice <--> gem
  voice <--> oai
  scripted --> voice

  classDef seam stroke-width:2px,stroke:#17527d,fill:#e7eff6,color:#12303f
  classDef gate stroke-width:2px,stroke:#8a5a12,fill:#faf1df,color:#4a3410
  classDef plain fill:#ffffff,stroke:#c7c2ba,color:#1a1c1e
  classDef ext fill:#efedea,stroke:#c7c2ba,color:#55595e

  class registry,match,voice seam
  class submit gate
  class boot,board,appl,filters,form,docks,scripted plain
  class person seam
  class gem,oai ext

  style tab fill:#ffffff,stroke:#c7c2ba,color:#55595e
  style scopes fill:#f7f6f4,stroke:#c7c2ba,color:#55595e
  style live fill:#f7f6f4,stroke:#c7c2ba,color:#55595e
```

**The polyfill installs at module scope.** React runs child effects before
parent effects, so a polyfill installed in any component's `useEffect` lands
after every descendant has already tried to register and given up. The page then
shows zero imperative tools, silently.

**The voice layer imports no tool definitions.** `useVoiceSession` asks
`document.modelContext.getTools()` and dispatches by name through
`executeTool()`. That indirection is the demo's actual claim: register a tool
anywhere in the app and the agent can call it without the voice code changing.

**The search is visible.** `find_matching_roles` does not just return rows: it
sets the filter bar to what it searched and rings the top result, so what the
agent says and what the person sees are the same search. `next_role` moves the
ring down the shortlist when they are not interested. That is why it is not
marked `readOnlyHint`.

**Two passes, then it asks.** `fill_step` fills what the profile holds and
reports the rest as unanswerable. `ask_for_field` then highlights one of those on
screen so the person can see which question is meant, and `correct_field` writes
what they say. No tool can tick the declaration.

**Nothing submits.** `prepare_submit` moves focus to the button and returns
`submitted: false`. There is no tool that presses it, so no spoken instruction
can, and the accuracy declaration is left unticked because that field has no
source in the profile.
