import { formatBusinessTime, useBusiness } from "../context/BusinessContext.jsx";

function ContactInformation() {
  const { businessSettings } = useBusiness();
  const { businessName, email, phone, address, openingTime, closingTime } = businessSettings;
  const formattedHours = `${formatBusinessTime(openingTime)} - ${formatBusinessTime(closingTime)}`;

  return (
    <section className="contact-information" aria-labelledby="contact-information-title">
      <div className="contact-information-inner">
        <div className="contact-information-heading">
          <span className="contact-information-label">Contact Information</span>
          <h2 id="contact-information-title">Come visit {businessName}.</h2>
          <p>We would love to welcome you for good food, refreshing drinks, and meaningful moments.</p>
        </div>

        <div className="contact-information-details">
          <div className="contact-information-item">
            <span className="contact-information-item-label">Email</span>
            <a href={`mailto:${email}`}>{email}</a>
          </div>

          <div className="contact-information-item">
            <span className="contact-information-item-label">Contact Number</span>
            <a href={`tel:${phone}`}>{phone}</a>
          </div>

          <div className="contact-information-item">
            <span className="contact-information-item-label">Location</span>
            <address>{address}</address>
          </div>

          <div className="contact-information-item contact-information-hours">
            <span className="contact-information-item-label">Opening Hours</span>
            <dl>
              <div>
                <dt>Monday - Friday</dt>
                <dd>{formattedHours}</dd>
              </div>
              <div>
                <dt>Saturday - Sunday</dt>
                <dd>{formattedHours}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ContactInformation;
