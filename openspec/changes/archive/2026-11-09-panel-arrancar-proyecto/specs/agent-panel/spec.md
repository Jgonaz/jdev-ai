## ADDED Requirements

### Requirement: Arrancar y parar un proyecto desde la barra lateral

Cada proyecto de la barra lateral SHALL tener un botón para arrancar su comando de arranque. El botón SHALL:

1. Crear una terminal sin agente en la carpeta principal del proyecto.
2. Ejecutar el comando dentro de la shell.
3. Abrir la terminal en una pestaña, titulada «dev · <proyecto>».

La terminal SHALL seguir en marcha en segundo plano al cerrar su pestaña.

Mientras esa terminal siga viva, el botón SHALL servir para pararla: SHALL enviar `Ctrl+C` y SHALL terminar la sesión, también si el proceso no ha terminado a los pocos segundos.

SHALL haber como mucho una terminal de arranque por proyecto.

El comando de arranque SHALL ser el comando propio del proyecto configurado en Ajustes. Si no hay ninguno, SHALL ser el script `dev` de su `package.json`, con el gestor que indique el proyecto. Si no hay ninguno de los dos, el botón SHALL estar desactivado y SHALL indicar cómo configurarlo.

#### Scenario: Arrancar un proyecto con script dev

- **WHEN** la persona pulsa ▶ en un proyecto con `pnpm-lock.yaml` y un script `dev`
- **THEN** se abre la terminal «dev · <proyecto>» ejecutando `pnpm dev` y el botón pasa a ■

#### Scenario: Dejarlo en segundo plano

- **WHEN** la persona cierra la pestaña de la terminal de arranque
- **THEN** el servidor sigue en marcha, la terminal aparece en «En segundo plano» y el botón sigue en ■

#### Scenario: Parar

- **WHEN** la persona pulsa ■
- **THEN** el panel envía `Ctrl+C`, termina la terminal y el botón vuelve a ▶

#### Scenario: Comando propio

- **WHEN** el proyecto tiene en Ajustes el comando `pnpm exec nuxt dev --port 3037`
- **THEN** ▶ ejecuta ese comando en lugar del detectado

#### Scenario: Sin comando

- **WHEN** el proyecto no tiene script `dev` ni comando propio
- **THEN** el botón está desactivado y su ayuda lleva a Ajustes › Proyectos

#### Scenario: Pulsar arrancar dos veces

- **WHEN** la terminal de arranque de un proyecto ya está viva y se vuelve a pedir arrancarlo
- **THEN** el panel abre esa misma terminal sin crear otra
