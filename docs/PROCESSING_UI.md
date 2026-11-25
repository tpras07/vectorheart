# Shared processing UI

ResearchLoading is a presentation-only, non-blocking status surface. It uses real busy flags and queued/running statuses; no fake timers or progress percentages. Review and approval states remain available. Error handling and request logic are unchanged. Covers homepage/workspace/canvas opening, graph generation and AI Accelerate, literature operations, research conversations, scientific operations, journal creation and evolution actions. Background autosave, incidental fetches and other minor actions are not exhaustively instrumented. Reduced motion is respected. This patch requires browser and full build verification.

The revised loading motif uses six abstract fragments moving into alignment with soft defocus, no spinner, glow, or invented progress. Only the loading component is animated. Existing results remain untouched; no artificial processing delay is introduced.
