import { commonParseMail } from "../common";
import { normalizeAddressDomain } from "../utils";
import { storeRawMail } from "./storage";

const INTERNAL_FORWARD_CONFIG_KEY = "admin-config:internal_forward_rules";

export type InternalForwardRule = {
    id?: string;
    name?: string;
    source: string;
    destination: string;
    includeKeywords: string[];
    excludeKeywords?: string[];
    searchSubject?: boolean;
    searchText?: boolean;
    searchHtml?: boolean;
    enabled?: boolean;
};

const getInternalForwardRules = async (env: Bindings): Promise<InternalForwardRule[]> => {
    try {
        const value = await env.DB.prepare(
            `SELECT value FROM settings WHERE key = ?`
        ).bind(INTERNAL_FORWARD_CONFIG_KEY).first<string>("value");
        if (!value) return [];

        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error("internal forward: failed to load rules", error);
        return [];
    }
};

const normalizeKeywords = (keywords: string[] | undefined): string[] => (
    Array.isArray(keywords)
        ? keywords.map(item => item.trim().toLowerCase()).filter(Boolean)
        : []
);

export const internalForwardEmail = async (
    env: Bindings,
    source: string,
    recipient: string,
    messageId: string | null,
    parsedEmailContext: ParsedEmailContext,
): Promise<void> => {
    const normalizedRecipient = normalizeAddressDomain(recipient);
    const rules = (await getInternalForwardRules(env)).filter(rule => (
        rule.enabled !== false
        && normalizeAddressDomain(rule.source) === normalizedRecipient
    ));

    if (!rules.length) return;

    const parsedEmail = await commonParseMail(parsedEmailContext);
    if (!parsedEmail) return;

    const forwardedDestinations = new Set<string>();

    for (const rule of rules) {
        const destination = normalizeAddressDomain(rule.destination);
        if (!destination || destination === normalizedRecipient || forwardedDestinations.has(destination)) {
            continue;
        }

        const includeKeywords = normalizeKeywords(rule.includeKeywords);
        const excludeKeywords = normalizeKeywords(rule.excludeKeywords);
        if (!includeKeywords.length) continue;

        const parts: string[] = [];
        if (rule.searchSubject !== false) parts.push(parsedEmail.subject ?? "");
        if (rule.searchText !== false) parts.push(parsedEmail.text ?? "");
        if (rule.searchHtml !== false) parts.push(parsedEmail.html ?? "");
        const searchableContent = parts.join("\n").toLowerCase();

        const includeMatched = includeKeywords.some(keyword => searchableContent.includes(keyword));
        if (!includeMatched) continue;

        const excludeMatched = excludeKeywords.some(keyword => searchableContent.includes(keyword));
        if (excludeMatched) {
            console.log(`internal forward: excluded ${normalizedRecipient} -> ${destination}`);
            continue;
        }

        const destinationExists = await env.DB.prepare(
            `SELECT id FROM address WHERE name = ? LIMIT 1`
        ).bind(destination).first("id");
        if (!destinationExists) {
            console.warn(`internal forward: destination address does not exist: ${destination}`);
            continue;
        }

        if (messageId) {
            const duplicate = await env.DB.prepare(
                `SELECT id FROM raw_mails WHERE address = ? AND message_id = ? LIMIT 1`
            ).bind(destination, messageId).first("id");
            if (duplicate) {
                console.log(`internal forward: duplicate skipped ${normalizedRecipient} -> ${destination}`);
                forwardedDestinations.add(destination);
                continue;
            }
        }

        const result = await storeRawMail(
            env,
            source,
            destination,
            messageId,
            parsedEmailContext.rawEmail,
        );

        if (result.success) {
            forwardedDestinations.add(destination);
            console.log(`internal forward: copied ${normalizedRecipient} -> ${destination}`);
        } else {
            console.error(`internal forward: failed ${normalizedRecipient} -> ${destination}`);
        }
    }
};
