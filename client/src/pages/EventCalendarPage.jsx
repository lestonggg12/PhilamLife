import React, { useState } from 'react'
import './EventCalendarPage.css'

export default function EventCalendarPage() {
  const [events, setEvents] = useState([
    { id: 1, title: 'Board Meeting', date: '2026-07-25', time: '6:00 PM', location: 'Clubhouse' },
    { id: 2, title: 'Community Clean-up Drive', date: '2026-08-02', time: '7:00 AM', location: 'Main Park' },
    { id: 3, title: 'Homeowners Annual Assembly', date: '2026-08-15', time: '2:00 PM', location: 'Multipurpose Hall' },
  ])

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', date: '', time: '', location: '' })

  const handleAdd = (e) => {
    e.preventDefault()
    if (!form.title || !form.date) return
    setEvents([...events, { id: Date.now(), ...form }])
    setForm({ title: '', date: '', time: '', location: '' })
    setShowForm(false)
  }

  const sorted = [...events].sort((a, b) => new Date(a.date) - new Date(b.date))

  return (
    <div className="cal-page">
      <div className="cal-header">
        <div>
          <h1>Event Calendar</h1>
          <p>Schedule and manage community meetings and events.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Schedule Event'}
        </button>
      </div>

      {showForm && (
        <form className="cal-form glass-card" onSubmit={handleAdd}>
          <input
            placeholder="Event title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            required
          />
          <input
            type="time"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
          />
          <input
            placeholder="Location"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
          <button type="submit" className="btn btn-primary">Save Event</button>
        </form>
      )}

      <div className="cal-list glass-card">
        {sorted.map((event) => (
          <div key={event.id} className="cal-row">
            <div className="cal-date-badge">
              <span className="cal-day">{new Date(event.date).getDate()}</span>
              <span className="cal-month">
                {new Date(event.date).toLocaleString('default', { month: 'short' })}
              </span>
            </div>
            <div className="cal-info">
              <p className="cal-title">{event.title}</p>
              <p className="cal-meta">{event.time} • {event.location}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}