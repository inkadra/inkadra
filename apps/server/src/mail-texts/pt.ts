import { type MailTexts, plural } from './it.ts';

export const pt: MailTexts = {
  lang: 'pt',
  locale: 'pt-BR',
  fallback: 'Se o botão não funcionar, copie este endereço no navegador:',
  sentBy: (instance) =>
    instance === 'Inkadra' ? 'Enviado pelo Inkadra.' : `Enviado por ${instance} com o Inkadra.`,
  join: (parts) =>
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : (parts[0] ?? ''),

  releaseSubject: (version) => `Novidades do Inkadra ${version}`,
  releaseBadge: (version) => `Versão ${version}`,
  releaseTitle: 'O que há de novo no Inkadra',
  releaseIntro: (instance, version, listed) =>
    listed
      ? `${instance} foi atualizado. Veja o que você já pode fazer a partir de hoje.`
      : `${instance} foi atualizado para o Inkadra ${version}. As notas da versão contam o que há de novo.`,
  releaseAction: 'Ler as notas da versão',
  releaseFooter: {
    text: 'Você ativou as novidades do Inkadra nas suas notificações.',
    link: 'Desative aqui',
    after: ' a qualquer momento.',
  },

  security: {
    badge: 'Alerta de segurança',
    events: {
      password: {
        title: 'Senha alterada',
        body: 'A senha da sua conta foi alterada e seus tokens de acesso pessoais foram revogados.',
        after:
          'Não reconhece esta alteração? Redefina sua senha e fale com o administrador imediatamente.',
      },
      twoFactor: {
        title: 'Verificação em duas etapas desativada',
        body: 'Sua conta não pede mais um código de verificação ao entrar.',
        after:
          'Não reconhece esta alteração? Altere sua senha, ative a verificação de novo e fale com o administrador imediatamente.',
      },
      token: {
        title: 'Novo token de acesso',
        body: 'Foi criado um token que pode acessar sua conta sem senha.',
        after:
          'Não reconhece esta alteração? Revogue o token e fale com o administrador imediatamente.',
      },
    },
    subject: (title, instance) => `${title} em ${instance}`,
    preheader: (title, token) =>
      `${token ? `Token “${token}” criado` : title}. Se não foi você, verifique agora.`,
    token: 'Token',
    when: 'Quando',
    expires: 'Expira',
    action: 'Verificar sua conta',
    footer: (instance) =>
      `Alerta de segurança de ${instance}: sempre enviado, não pode ser desativado.`,
  },

  inviteSubject: (who, what) => `${who} convidou você para ${what}`,
  inviteIntro: {
    project: 'Entre ou crie sua conta para trabalhar no projeto com o resto da equipe.',
    board: 'Entre ou crie sua conta para trabalhar no quadro com o resto da equipe.',
    instance: 'Entre ou crie sua conta para começar.',
  },
  invitePreheader: (days) =>
    `Entre ou crie sua conta para começar. O convite é válido por ${plural(days, 'um dia', 'dias')}.`,
  inviteFacts: { project: 'Projeto', board: 'Quadro', role: 'Função', expires: 'Expira' },
  roles: {
    owner: 'Proprietário: gerencia o projeto, as pessoas e os quadros',
    editor: 'Editor: pode criar e editar quadros',
    commenter: 'Comentarista: pode visualizar e comentar',
    viewer: 'Visualizador: só pode visualizar',
  },
  inviteAction: 'Abrir o convite',
  inviteFooter: 'Não esperava este convite? Você pode ignorar este e-mail.',

  magicSubject: (instance) => `Seu link de acesso a ${instance}`,
  magicTitle: (instance) => `Entrar em ${instance}`,
  magicIntro: 'Use o botão para entrar, sem precisar de senha.',
  magicNote: { text: 'O link funciona uma única vez, por 15 minutos.', strong: '15 minutos' },
  magicPreheader: 'Funciona uma única vez, por 15 minutos.',
  magicAction: 'Entrar',
  magicFooter: 'Não pediu este link? Ignore este e-mail: ninguém consegue entrar sem ele.',

  resetSubject: (instance) => `Redefina sua senha de ${instance}`,
  resetTitle: 'Escolha uma nova senha',
  resetIntro: (instance) =>
    `Recebemos um pedido para redefinir a senha da sua conta em ${instance}.`,
  resetPreheader: 'Se você não pediu, sua senha continua a mesma.',
  resetAction: 'Escolher uma nova senha',
  resetFooter: 'Não pediu? Ignore este e-mail: sua senha continua a mesma.',

  someone: 'Alguém',
  guestName: (name) => `${name} (convidado)`,
  today: 'Hoje',
  yesterday: 'Ontem',
  reviewStatuses: {
    none: 'nenhuma',
    in_review: 'em revisão',
    approved: 'aprovado',
    changes_requested: 'alterações solicitadas',
  },
  verbs: {
    mention: 'mencionou você',
    reply: 'respondeu em uma conversa',
    comment: 'comentou em um card seu',
    review: 'alterou a revisão',
    task_assigned: 'atribuiu uma tarefa a você',
    invitation_accepted: 'aceitou seu convite',
  },
  wrote: 'escreveu',
  unknownVerb: 'tem uma novidade para você',
  linkOpened: (label) =>
    label
      ? { who: `O link ${label}`, what: 'foi aberto por um convidado' }
      : { who: 'Um convidado', what: 'abriu um link de compartilhamento' },
  ownExpiring: (where, when) => `Seu acesso a ${where} termina em ${when}`,
  ownExpiringTail: (where) => `seu acesso a ${where} prestes a terminar`,
  ownExpired: { who: 'Seu acesso', what: 'terminou' },
  otherExpiring: (when) => `perde o acesso em ${when}`,
  otherExpired: 'não tem mais acesso',
  counts: {
    mention: (n) => plural(n, 'uma menção', 'menções'),
    reply: (n) => plural(n, 'uma resposta', 'respostas'),
    comment: (n) => plural(n, 'um comentário', 'comentários'),
    review: (n) => plural(n, 'uma revisão', 'revisões'),
    task_assigned: (n) => plural(n, 'uma tarefa', 'tarefas'),
  },
  more: 'mais coisas para ver',
  singleSubject: (sentence, where) => (where ? `${sentence} em ${where}` : sentence),
  digestTitle: (n, daily) =>
    `${n} ${n === 1 ? 'novidade' : 'novidades'}${daily ? ' desde ontem' : ''}`,
  digestSubject: (n, instance, summary) =>
    `${n} ${n === 1 ? 'novidade' : 'novidades'} em ${instance}${summary ? `: ${summary}` : ''}`,
  replyAction: 'Responder ao comentário',
  openBoard: 'Abrir o quadro',
  openProject: 'Abrir o projeto',
  openInkadra: 'Abrir o Inkadra',
  openInbox: 'Abrir a caixa de entrada',
  open: 'Abrir',
  notificationFooter: {
    text: (instance) => `Você recebe estes e-mails pelas notificações de ${instance}.`,
    link: 'Escolha quais e quando',
    after: '.',
  },
  calendar: {
    deadline: (task, board) => `Prazo: ${task} · ${board}`,
    todo: (board) => `Tarefa · quadro "${board}" · dia inteiro`,
    call: (time, place, wrap) =>
      [`Chamada ${time}`, place, wrap && `término ${wrap}`].filter(Boolean).join(' · '),
  },
};
