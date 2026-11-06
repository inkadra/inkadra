import { type MailTexts, plural } from './it.ts';

export const es: MailTexts = {
  lang: 'es',
  locale: 'es-ES',
  fallback: 'Si el botón no funciona, copia esta dirección en tu navegador:',
  sentBy: (instance) =>
    instance === 'Inkadra' ? 'Enviado por Inkadra.' : `Enviado por ${instance} con Inkadra.`,
  join: (parts) =>
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : (parts[0] ?? ''),

  releaseSubject: (version) => `Novedades de Inkadra ${version}`,
  releaseBadge: (version) => `Versión ${version}`,
  releaseTitle: 'Novedades de Inkadra',
  releaseIntro: (instance, version, listed) =>
    listed
      ? `${instance} se actualizó. Esto es lo que puedes hacer desde hoy.`
      : `${instance} se actualizó a Inkadra ${version}. Las notas de la versión cuentan las novedades.`,
  releaseAction: 'Leer las notas de la versión',
  releaseFooter: {
    text: 'Activaste las novedades de Inkadra en tus notificaciones.',
    link: 'Desactívalas aquí',
    after: ' cuando quieras.',
  },

  security: {
    badge: 'Alerta de seguridad',
    events: {
      password: {
        title: 'Contraseña cambiada',
        body: 'Se cambió la contraseña de tu cuenta y se revocaron tus tokens de acceso personales.',
        after:
          '¿No reconoces este cambio? Restablece tu contraseña y contacta con tu administrador de inmediato.',
      },
      twoFactor: {
        title: 'Verificación en dos pasos desactivada',
        body: 'Tu cuenta ya no pide un código de verificación al iniciar sesión.',
        after:
          '¿No reconoces este cambio? Cambia tu contraseña, vuelve a activar la verificación y contacta con tu administrador de inmediato.',
      },
      token: {
        title: 'Nuevo token de acceso',
        body: 'Se creó un token que puede acceder a tu cuenta sin contraseña.',
        after:
          '¿No reconoces este cambio? Revoca el token y contacta con tu administrador de inmediato.',
      },
    },
    subject: (title, instance) => `${title} en ${instance}`,
    preheader: (title, token) =>
      `${token ? `Token “${token}” creado` : title}. Si no fuiste tú, compruébalo ahora.`,
    token: 'Token',
    when: 'Cuándo',
    expires: 'Caduca',
    action: 'Revisar tu cuenta',
    footer: (instance) =>
      `Alerta de seguridad de ${instance}: se envía siempre, no se puede desactivar.`,
  },

  inviteSubject: (who, what) => `${who} te invitó a ${what}`,
  inviteIntro: {
    project: 'Inicia sesión o crea tu cuenta para trabajar en el proyecto con el resto del equipo.',
    board: 'Inicia sesión o crea tu cuenta para trabajar en el tablero con el resto del equipo.',
    instance: 'Inicia sesión o crea tu cuenta para empezar.',
  },
  invitePreheader: (days) =>
    `Inicia sesión o crea tu cuenta para empezar. La invitación es válida durante ${plural(days, 'un día', 'días')}.`,
  inviteFacts: { project: 'Proyecto', board: 'Tablero', role: 'Rol', expires: 'Caduca' },
  roles: {
    owner: 'Propietario: gestiona el proyecto, sus personas y sus tableros',
    editor: 'Editor: puede crear y editar tableros',
    commenter: 'Comentarista: puede ver y comentar',
    viewer: 'Lector: solo puede ver',
  },
  inviteAction: 'Abrir la invitación',
  inviteFooter: '¿No esperabas esta invitación? Puedes ignorar este correo.',

  magicSubject: (instance) => `Tu enlace de acceso a ${instance}`,
  magicTitle: (instance) => `Inicia sesión en ${instance}`,
  magicIntro: 'Usa el botón para iniciar sesión, sin contraseña.',
  magicNote: { text: 'El enlace funciona una sola vez, durante 15 minutos.', strong: '15 minutos' },
  magicPreheader: 'Funciona una sola vez, durante 15 minutos.',
  magicAction: 'Iniciar sesión',
  magicFooter: '¿No pediste este enlace? Ignora este correo: nadie puede entrar sin él.',

  resetSubject: (instance) => `Restablece tu contraseña de ${instance}`,
  resetTitle: 'Elige una contraseña nueva',
  resetIntro: (instance) =>
    `Recibimos una solicitud para restablecer la contraseña de tu cuenta en ${instance}.`,
  resetPreheader: 'Si no la pediste, tu contraseña sigue igual.',
  resetAction: 'Elegir una contraseña nueva',
  resetFooter: '¿No la pediste? Ignora este correo: tu contraseña sigue igual.',

  someone: 'Alguien',
  guestName: (name) => `${name} (invitado)`,
  today: 'Hoy',
  yesterday: 'Ayer',
  reviewStatuses: {
    none: 'ninguna',
    in_review: 'en revisión',
    approved: 'aprobada',
    changes_requested: 'cambios solicitados',
  },
  verbs: {
    mention: 'te mencionó',
    reply: 'respondió en un hilo',
    comment: 'comentó en una de tus tarjetas',
    review: 'cambió la revisión',
    task_assigned: 'te asignó una tarea',
    invitation_accepted: 'aceptó tu invitación',
  },
  wrote: 'escribió',
  unknownVerb: 'tiene algo nuevo para ti',
  linkOpened: (label) =>
    label
      ? { who: `El enlace ${label}`, what: 'fue abierto por un invitado' }
      : { who: 'Un invitado', what: 'abrió un enlace compartido' },
  ownExpiring: (where, when) => `Tu acceso a ${where} termina el ${when}`,
  ownExpiringTail: (where) => `tu acceso a ${where} termina pronto`,
  ownExpired: { who: 'Tu acceso', what: 'terminó' },
  otherExpiring: (when) => `pierde el acceso el ${when}`,
  otherExpired: 'ya no tiene acceso',
  counts: {
    mention: (n) => plural(n, 'una mención', 'menciones'),
    reply: (n) => plural(n, 'una respuesta', 'respuestas'),
    comment: (n) => plural(n, 'un comentario', 'comentarios'),
    review: (n) => plural(n, 'una revisión', 'revisiones'),
    task_assigned: (n) => plural(n, 'una tarea', 'tareas'),
  },
  more: 'algo más por ver',
  singleSubject: (sentence, where) => (where ? `${sentence} en ${where}` : sentence),
  digestTitle: (n, daily) =>
    `${n} ${n === 1 ? 'novedad' : 'novedades'}${daily ? ' desde ayer' : ''}`,
  digestSubject: (n, instance, summary) =>
    `${n} ${n === 1 ? 'novedad' : 'novedades'} en ${instance}${summary ? `: ${summary}` : ''}`,
  replyAction: 'Responder al comentario',
  openBoard: 'Abrir el tablero',
  openProject: 'Abrir el proyecto',
  openInkadra: 'Abrir Inkadra',
  openInbox: 'Abrir la bandeja',
  open: 'Abrir',
  notificationFooter: {
    text: (instance) => `Recibes estos correos por las notificaciones de ${instance}.`,
    link: 'Elige cuáles y cuándo',
    after: '.',
  },
  calendar: {
    deadline: (task, board) => `Fecha límite: ${task} · ${board}`,
    todo: (board) => `Tarea · tablero "${board}" · todo el día`,
    call: (time, place, wrap) =>
      [`Citación ${time}`, place, wrap && `fin ${wrap}`].filter(Boolean).join(' · '),
  },
};
