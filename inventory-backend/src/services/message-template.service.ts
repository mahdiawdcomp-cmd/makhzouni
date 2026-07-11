import prisma from "../config/database";
import { AppError } from "../utils/app-error";

export type TemplateVariables = Record<string, string | number | null | undefined>;

export async function listMessageTemplates() {
  return prisma.messageTemplate.findMany({
    orderBy: { createdAt: "asc" },
  });
}


const QUICK_REPLY_TYPE = "QUICK_REPLY";

/** Canned replies for the WhatsApp chat composer — a filtered slice of the
 * same MessageTemplate table used for automated triggers. */
export async function listQuickReplies() {
  return prisma.messageTemplate.findMany({
    where: { type: QUICK_REPLY_TYPE, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function createQuickReply(name: string, body: string) {
  return prisma.messageTemplate.create({
    data: { name, body, type: QUICK_REPLY_TYPE, isActive: true },
  });
}

export async function deleteQuickReply(id: string) {
  const template = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!template || template.type !== QUICK_REPLY_TYPE) {
    throw new AppError("الرد الجاهز غير موجود", 404, "TEMPLATE_NOT_FOUND");
  }
  await prisma.messageTemplate.delete({ where: { id } });
}

export async function updateMessageTemplate(
  id: string,
  input: {
    name?: string;
    body?: string;
    type?: string;
    isActive?: boolean;
  }
) {
  const template = await prisma.messageTemplate.findUnique({ where: { id } });

  if (!template) {
    throw new AppError("Message template not found", 404, "TEMPLATE_NOT_FOUND");
  }

  return prisma.messageTemplate.update({
    where: { id },
    data: input,
  });
}

export async function getTemplateByType(type: string) {
  const template = await prisma.messageTemplate.findFirst({
    where: {
      type,
      isActive: true,
    },
  });

  if (!template) {
    throw new AppError(`Message template not found: ${type}`, 404, "TEMPLATE_NOT_FOUND");
  }

  return template;
}

export function renderTemplate(body: string, variables: TemplateVariables) {
  return body.replace(/\{(\w+)\}/g, (_match, key: string) =>
    String(variables[key] ?? "")
  );
}

export async function renderTemplateByType(
  type: string,
  variables: TemplateVariables
) {
  const template = await getTemplateByType(type);
  return renderTemplate(template.body, variables);
}
