import React from 'react'
import { useNavigate } from 'react-router-dom'
import ErrorPage from '../components/ErrorPage'

export default function NotFoundPage({ homePath, homeLabel }) {
  const navigate = useNavigate()

  return (
    <ErrorPage
      icon="notFound"
      code="404"
      title="Page not found"
      message="The page you're looking for doesn't exist or may have been moved."
      actions={[
        { label: homeLabel, to: homePath, primary: true },
        { label: 'Go back', onClick: () => navigate(-1) },
      ]}
    />
  )
}