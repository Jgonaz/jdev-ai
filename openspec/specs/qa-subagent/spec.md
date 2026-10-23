# qa-subagent Specification

## Purpose
Esta capacidad permite verificar de punta a punta una implementación terminada sin gastar el contexto del orquestador. Un subagente de QA prueba la funcionalidad con Playwright en el entorno de desarrollo, cubre más que el happy path, pide autorización antes de cualquier prueba mutable y compara el resultado con el diseño de Claude Design.
## Requirements
### Requirement: El launcher registra el subagente qa con Playwright

`adapters/claude/agents.json` SHALL definir un subagente `qa` con modelo Sonnet, esfuerzo `high` y sin herramientas de edición. SHALL incluir en su `mcpServers` una definición inline del MCP de Playwright, fijada a una versión concreta. El MCP de Playwright SHALL NOT registrarse para la sesión principal ni para otros subagentes.

#### Scenario: Sesión de Claude lanzada con el launcher

- **WHEN** se ejecuta `bin/agent <proyecto>` con Claude
- **THEN** `--agents` incluye `qa` con su `mcpServers` de Playwright, y la sesión principal no recibe ese MCP

### Requirement: El QA prueba en el entorno de desarrollo

El QA SHALL probar en el entorno de desarrollo local que declare el apartado `## QA` del `AGENTS.md` del proyecto, salvo que el encargo indique otro entorno de forma explícita. SHALL usar el MCP de Playwright para las comprobaciones en el navegador. Si falta un dato imprescindible para arrancar o acceder al entorno, SHALL devolver un bloqueo con lo que falta en lugar de inventarlo. Si deduce un dato no crítico, SHALL declararlo en el informe.

#### Scenario: Proyecto con apartado de QA

- **WHEN** el orquestador delega en `qa` sin indicar entorno
- **THEN** el QA arranca el entorno de desarrollo con el comando declarado y prueba contra su URL

#### Scenario: Falta la forma de acceder

- **WHEN** el proyecto no declara cómo arrancar la aplicación ni se puede deducir
- **THEN** el QA no prueba y devuelve un bloqueo que indica qué dato falta

#### Scenario: Otro entorno indicado

- **WHEN** el encargo indica expresamente un entorno de staging
- **THEN** el QA prueba contra ese entorno y no contra el de desarrollo

### Requirement: La cobertura va más allá del happy path

El QA SHALL derivar los casos del cambio que recibe (diff, alcance, spec OpenSpec o encargo). SHALL cubrir, cuando apliquen al cambio, el happy path, las validaciones y los datos límite, los errores, los estados vacíos y de carga, los permisos, la navegación, el responsive y la accesibilidad básica. SHALL declarar los casos que no ha cubierto y el motivo.

#### Scenario: Formulario nuevo

- **WHEN** el cambio añade un formulario con validación
- **THEN** el QA prueba el envío correcto, los campos inválidos y vacíos, el error del servidor y el uso con teclado, y declara lo que no pudo probar

### Requirement: Las pruebas mutables requieren autorización previa

El QA SHALL considerar mutable toda prueba que cree, modifique o borre datos persistentes o que tenga efectos externos, y SHALL tratar como mutable cualquier caso dudoso. SHALL NOT ejecutar una prueba mutable sin autorización. Primero SHALL ejecutar solo las pruebas no mutables y SHALL devolver la lista de mutables propuestas, con sus efectos y su reversibilidad. El orquestador SHALL presentar esa lista a la persona, SHALL esperar su respuesta y SHALL retomar al mismo QA indicándole las pruebas aprobadas. El QA SHALL ejecutar únicamente esas.

#### Scenario: Pruebas mutables aprobadas en parte

- **WHEN** el QA propone crear un pedido y enviar un correo, y la persona aprueba solo crear el pedido
- **THEN** el QA crea el pedido, no envía el correo y lo indica en el informe

#### Scenario: Sin pruebas mutables

- **WHEN** todas las pruebas del cambio son de solo lectura
- **THEN** el QA termina sin pedir autorización

#### Scenario: Efecto inesperado

- **WHEN** una prueba considerada no mutable persiste datos
- **THEN** el QA se detiene y lo reporta antes de seguir

### Requirement: El QA valida la fidelidad a Claude Design

Si no se indica otra fuente, el QA SHALL usar como referencia el artifact de Claude Design que reciba del orquestador. SHALL compararlo con la aplicación en los mismos viewports, en layout, espaciados, tipografía, colores, textos, iconos, estados y responsive. SHALL reportar cada desviación con una captura del diseño, una de la app y su gravedad. SHALL marcar como «no especificado» lo que el diseño no define. Si no puede renderizar el diseño fielmente, SHALL indicar qué fuente ha usado.

#### Scenario: Desviación de espaciado

- **WHEN** la app muestra una tarjeta con un padding distinto al del diseño
- **THEN** el informe incluye la desviación con ambas capturas, el viewport y su gravedad

#### Scenario: Estado sin diseño

- **WHEN** el diseño no define el estado de error de una lista
- **THEN** el QA lo marca como «no especificado» y no como fallo

### Requirement: El QA no escribe en el proyecto y propone los tests e2e

El subagente `qa` SHALL NOT tener herramientas de edición. SHALL NOT modificar el repositorio del proyecto y SHALL guardar las evidencias fuera de él. Para los casos que merezcan quedar como regresión, SHALL devolver una especificación de tests e2e con pasos, selectores comprobados, aserciones y datos. Si la persona quiere conservar esos tests, el orquestador SHALL delegar su escritura en el `implementer` y su ejecución en el `validator`.

#### Scenario: Bug encontrado

- **WHEN** el QA encuentra un fallo en la aplicación
- **THEN** lo reporta con su evidencia y no modifica el código; el arreglo lo hace el implementador

#### Scenario: Caso que merece test de regresión

- **WHEN** el QA verifica un flujo crítico que no tiene test e2e
- **THEN** devuelve su especificación de test y el orquestador, si la persona lo quiere, encarga al `implementer` que lo escriba

### Requirement: El QA devuelve un informe con evidencia y limpia lo que arranca

El QA SHALL devolver un informe compacto con:

- el entorno usado;
- los casos probados;
- cada fallo con sus pasos, el resultado esperado frente al observado, la evidencia y su gravedad, marcado como «confirmado» o «hipótesis»;
- las desviaciones de diseño;
- la especificación de los tests e2e propuestos;
- los casos no cubiertos.

Antes de devolverlo, SHALL cerrar el navegador y SHALL detener los servidores y procesos que haya arrancado.

#### Scenario: Fin de la sesión de QA

- **WHEN** el QA termina sus pruebas
- **THEN** no quedan activos el servidor de desarrollo ni el navegador que arrancó, y el informe distingue los fallos confirmados de las hipótesis

