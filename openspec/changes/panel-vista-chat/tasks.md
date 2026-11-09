## 0. Proceso

- [x] 0.1 Revisión del cambio OpenSpec con la persona
- [x] 0.2 Diseño de la vista chat en Claude Design aprobado y URL anotada en `design.md`

## 1. Servidor del panel

- [x] 1.1 Modo conversación en `parseAgentLines` con eventos `user` y fixtures reales
- [x] 1.2 `conversation` en `Follower` desde el `transcriptPath` del estado, con validación de ruta
- [x] 1.3 `GET /api/sessions/:nombre/conversation` con `from`
- [x] 1.4 `POST /api/sessions/:nombre/input` con pegado entre corchetes
- [x] 1.5 `chat` en `SessionInfo` y pruebas

## 2. Cliente

- [x] 2.1 Conmutador Terminal / Chat en la cabecera, con preferencia por pestaña
- [x] 2.2 `ChatBody` con mensajes, grupos de herramientas, autoscroll y estados
- [x] 2.3 Búsqueda con resaltado y navegación
- [x] 2.4 Caja de entrada y aviso de espera en la terminal
- [x] 2.5 Pruebas de `lib/chat.ts`

## 3. Documentación y validación

- [x] 3.1 README
- [x] 3.2 `bin/check`, `pnpm --dir panel typecheck`, `test`, `build` y `openspec validate --strict`
- [ ] 3.3 QA con fidelidad al diseño, si la persona da el visto bueno
