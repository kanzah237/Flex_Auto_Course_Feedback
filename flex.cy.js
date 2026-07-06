/**
 * FLEX (flexstudent.nu.edu.pk) - Course Feedback auto-submission.
 *
 * Fully automated EXCEPT the reCAPTCHA, which you solve manually. The test fills
 * your credentials, waits for you to tick the reCAPTCHA, logs in, then opens
 * every course feedback, selects "Agree" for each question, and submits.
 *
 * SETUP (one time): put your credentials in cypress.env.json (already gitignored):
 *   { "FLEX_USER": "24F-0611", "FLEX_PASS": "your-password" }
 *
 * Run in interactive mode so you can solve the reCAPTCHA:
 *   npx cypress open
 *
 * NOTE: The site is behind a login, so the selectors past login are best-guesses.
 * When a step fails, right-click the element -> Inspect and adjust it. Likely
 * spots to tweak are marked TODO.
 */
describe('FLEX - Course Feedback', () => {
  beforeEach(() => {
    // Ignore uncaught app errors so they don't fail the test
    cy.on('uncaught:exception', () => false)
  })

  it('agrees to and submits every course feedback', () => {
    const user = Cypress.env('FLEX_USER')
    const pass = Cypress.env('FLEX_PASS')
    expect(user, 'FLEX_USER in cypress.env.json').to.be.a('string').and.not.be.empty
    expect(pass, 'FLEX_PASS in cypress.env.json').to.be.a('string').and.not.be.empty

    // 1. Open the FLEX student portal
    cy.visit('https://flexstudent.nu.edu.pk/', { failOnStatusCode: false })

    // 2. Auto-fill credentials.  TODO: adjust field selectors if login fails.
    cy.get('input[type="text"], input[name="username"], input[name="rollno"], #username', { timeout: 20000 })
      .filter(':visible')
      .first()
      .clear()
      .type(user)
    cy.get('input[type="password"], input[name="password"], #password')
      .filter(':visible')
      .first()
      .clear()
      .type(pass, { log: false })

    // 3. SOLVE THE reCAPTCHA MANUALLY now. Instead of a fixed wait, the test
    //    continues the moment you tick the box: solving the reCAPTCHA fills the
    //    hidden `g-recaptcha-response` field, so we wait for that to get a value.
    cy.log('👉 Solve the reCAPTCHA now - it continues automatically the instant you tick it')
    cy.get('body').then(($b) => {
      const hasCaptcha = $b.find(
        '.g-recaptcha, iframe[src*="recaptcha"], textarea[name="g-recaptcha-response"]'
      ).length
      if (hasCaptcha) {
        // Proceeds as soon as the response token is set (waits up to 2 min).
        cy.get('textarea[name="g-recaptcha-response"]', { timeout: 120000 }).should(($t) => {
          expect($t.val(), 'reCAPTCHA solved').to.not.be.empty
        })
      }
    })

    // 4. Submit the login form automatically.
    cy.get('button[type="submit"], input[type="submit"], button:contains("Login"), button:contains("Sign In"), input[value="Login"]')
      .filter(':visible')
      .first()
      .click({ force: true })

    // Wait for the dashboard to load after login.
    cy.wait(4000)

    // 5. Check whether there is any course to submit feedback on.
    //    If there is none, the test passes as OK. If feedback IS pending, fill it.
    cy.get('body', { timeout: 20000 }).then(($body) => {
      const pageText = $body.text()

      // No feedback pending: portal shows an "information not available" style
      // message, or there are simply no feedback links on the page.
      const noFeedback =
        /course\s*information\s*is\s*not\s*available|no\s*course\s*information|information\s*is\s*not\s*available|not\s*available\s*yet|no\s*feedback/i.test(
          pageText
        )

      const feedbackLinks = $body
        .find('a:contains("Feedback"), a:contains("Submit"), button:contains("Feedback"), .feedback-open')
        .filter(':visible')

      if (noFeedback || feedbackLinks.length === 0) {
        // Nothing to submit feedback on -> test is OK.
        cy.log('✅ No course to submit feedback on - test OK.')
        expect(true, 'no course to submit feedback on').to.be.true
      } else {
        // Feedback is pending -> fill and submit it.
        cy.log('📝 Course feedback is pending - filling the feedback form.')
        submitAllFeedbacks()
      }
    })
  })
})

/**
 * Opens each pending course feedback, selects "Agree" for every question,
 * clicks Submit, then returns to the list and repeats until none remain.
 */
function submitAllFeedbacks() {
  // Re-query the list each pass because the DOM changes after a submission.
  cy.get('body', { timeout: 20000 }).then(($body) => {
    // TODO: adjust this selector to whatever represents a single "open feedback" link/button.
    const openLinks = $body
      .find('a:contains("Submit"), a:contains("Feedback"), button:contains("Submit Feedback"), .feedback-open, a:contains("Open")')
      .filter(':visible')

    if (openLinks.length === 0) {
      // No more pending feedback forms to fill.
      cy.log('No more pending course feedback forms.')
      return
    }

    // Open the first pending feedback
    cy.wrap(openLinks.first()).click({ force: true })

    // Select "Agree" for every question on the form.
    agreeToAllQuestions()

    // Submit this course's feedback - but only if a real Submit button exists.
    // If there is none, there was no actual feedback form: display success and stop.
    cy.get('body').then(($b) => {
      const submitBtn = $b
        .find('button, input[type="submit"], a')
        .filter(':visible')
        .filter((i, el) => {
          const t = (el.textContent || el.value || '').trim()
          return /^submit$|submit feedback/i.test(t)
        })

      if (submitBtn.length === 0) {
        // No submit button -> nothing to actually submit; pass as OK.
        cy.log('✅ No course to submit feedback on - test OK.')
        return
      }

      cy.wrap(submitBtn.first()).click({ force: true })

      // Handle a confirmation dialog if one pops up.
      cy.get('body').then(($c) => {
        const confirm = $c
          .find('button:contains("OK"), button:contains("Yes"), button:contains("Confirm")')
          .filter(':visible')
        if (confirm.length) {
          cy.wrap(confirm.first()).click({ force: true })
        }
      })

      // Give the app a moment to save and return to the list, then recurse.
      cy.wait(1500)
      submitAllFeedbacks()
    })
  })
}

/**
 * Clicks the "Agree" option for every question on the current feedback form.
 * Feedback forms are usually a grid of radio buttons; "Agree" is one column.
 */
function agreeToAllQuestions() {
  cy.get('body').then(($body) => {
    // Strategy A: radios/labels whose value or text is "Agree".
    const agreeByValue = $body.find('input[type="radio"][value*="Agree"], input[type="radio"][value*="agree"]').filter(':visible')
    const agreeByLabel = $body.find('label:contains("Agree")').filter(':visible')

    if (agreeByValue.length) {
      agreeByValue.each((i, el) => cy.wrap(el).check({ force: true }))
    } else if (agreeByLabel.length) {
      agreeByLabel.each((i, el) => cy.wrap(el).click({ force: true }))
    } else {
      // Strategy B (fallback): pick a consistent radio column for each question row.
      // TODO: set the correct column index for "Agree" (0-based) on your form.
      const AGREE_COLUMN_INDEX = 1
      cy.get('tr, .question, .feedback-row')
        .filter(':visible')
        .each(($row) => {
          const radios = $row.find('input[type="radio"]')
          if (radios.length > AGREE_COLUMN_INDEX) {
            cy.wrap(radios.eq(AGREE_COLUMN_INDEX)).check({ force: true })
          }
        })
    }
  })
}
