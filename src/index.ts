import { REST } from "@discordjs/rest"
import {
    RESTPostAPIChannelMessageJSONBody as ChannelMessageBody,
    RESTPostAPICurrentUserCreateDMChannelJSONBody as CreateDMChannelBody,
    RESTPostAPICurrentUserCreateDMChannelResult as CreateDMChannelResult,
    Routes,
} from "discord-api-types/v10"
import { config } from "dotenv"
import { readFile, writeFile } from "node:fs/promises"
import { chromium, type Browser, type Page } from "playwright"

interface Data {
    course: string
    grade: string
    testDate: string
    sufficient: boolean | null
}

config()

const DATA_FILE = "./data/grade.json"
const INTERVAL = 300e3 // 5 minutes
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN)

runInterval()

async function runInterval() {
    try {
        await runBrowser()
    } catch (err) {
        console.error(err)
    }
    setTimeout(runInterval, INTERVAL)
}

async function runBrowser() {
    const browser = await chromium.launch({ headless: true })
    const page = await loadPage(browser)

    await login(page)
    await getNewGrade(page)

    await browser.close()
}

async function loadPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage()
    await page.goto(process.env.GRADES_URL)
    return page
}

async function login(page: Page) {
    await page.waitForSelector("input#login")
    await page.locator("input#login").type(process.env.STUDENT_PORTAL_USERNAME)
    await page.locator("input#passwd").type(process.env.STUDENT_PORTAL_PASSWORD)
    await page.locator("#nsg-x1-logon-button").click()
}

async function getNewGrade(page: Page) {
    const course = await page.locator("span#CRSE_CATALOG_DESCR\\$0").innerText()
    const [grade, sufficient] = await page.locator("span#IH_PT_RES_VW_CRSE_GRADE_OFF\\$0").evaluate(node => {
        const classes = node.parentNode.classList
        let earnCredits = null
        if (classes.contains("earn_credits_yes"))
            earnCredits = true
        if (classes.contains("earn_credits_no"))
            earnCredits = false
        return [node.innerText, earnCredits]
    })

    let testDate = await page.locator("span#IH_PT_RES_VW_GRADE_DT\\$0").innerText()
    testDate = new Date(testDate).toLocaleDateString("en-US", { dateStyle: "long" })

    if ((await readData()).course !== course) {
        console.log(`New grade: ${course} (${grade}) taken on ${testDate}`)

        const data = { course, grade, testDate, sufficient }

        await writeData(data)
        await sendDiscordMessage(data)
    }
}

async function writeData(data: Data) {
    await writeFile(DATA_FILE, JSON.stringify(data))
}

async function readData(): Promise<Data> {
    try {
        return JSON.parse(await readFile(DATA_FILE, "utf-8"))
    } catch {
        const data = { course: null, grade: null, testDate: null, sufficient: null }
        await writeData(data)
        return data
    }
}

async function sendDiscordMessage({ course, grade, testDate, sufficient }: Data) {
    const channel = await rest.post(Routes.userChannels(), {
        body: {
            recipient_id: process.env.DISCORD_USER_ID,
        } satisfies CreateDMChannelBody
    }) as CreateDMChannelResult

    let value = grade
    if (sufficient !== null) value += sufficient ? " ✅" : " ❌"

    await rest.post(Routes.channelMessages(channel.id), {
        body: {
            embeds: [{
                title: "New grade",
                fields: [{
                    name: course,
                    value,
                }],
                footer: {
                    text: `Test taken on ${testDate}`,
                },
            }]
        } satisfies ChannelMessageBody
    })
}
