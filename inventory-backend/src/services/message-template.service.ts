import prisma from "../config/database";
import { AppError } from "../utils/app-error";

export type TemplateVariables = Record<string, string | number | null | undefined>;

export async function listMessageTemplates() {
  return prisma.messageTemplate.findMany({
    orderBy: { createdAt: "asc" },
  });
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
